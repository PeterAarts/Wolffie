// core/strategies/SmartEcoStrategy.js
//
// Smart Eco — minimise energy cost using day-ahead prices, solar forecast,
// and a slot-by-slot SoC simulation derived from the nightly load profile.
//
// Decision inputs (from strategyManager._buildContext()):
//   context.soc              -- current battery SoC (%)
//   context.currentPrice     -- current day-ahead price (ct/kWh)
//   context.prices[]         -- { datetime, price } for the rolling window
//   context.solarForecast[]  -- { datetime|hour, watts } for the rolling window
//
// Strategy config (strategy_config table, strategy_id = 'smart-eco'):
//   batteryCapacityKwh        -- usable battery size (default 11.2)
//   minSocPct                 -- hard floor, never discharge below this (default 20)
//   chargePowerWatts          -- grid charge rate (default 3000)
//   negativePriceThreshold    -- ct/kWh below which price is "negative" (default 0)
//   solarSurplusThresholdKwh  -- min forecast kWh for solar to be "strong" (default 5)
//   nightlyProfile            -- written by aggregatorService.calculateNightlyProfile()
//
// Core philosophy: SELF-CONSUMPTION FIRST.
//   Never export what we produce. Never import what we can avoid.
//   Battery is used as a buffer — charged from solar, discharged to home load.
//   Grid charging only when solar cannot cover the gap (winter/weak solar).
//   No grid charging during negative prices — ever.
//
// Day plan generation (generateFullDayPlan):
//   Runs hourly. Simulates the battery SoC slot-by-slot (96 × 15-min) starting
//   from the current real SoC. For each slot it applies:
//     1. Solar offsets home load first; surplus charges the battery.
//     2. If projected SoC would breach minSocPct → CHARGE_FROM_GRID (winter only).
//     3. If price is negative and SoC == 100% → SOLAR_CURTAIL.
//     4. If price is negative and SoC < 100% → IDLE (solar filling battery).
//     5. If solar surplus and battery is full → SOLAR_SURPLUS.
//     6. Pre-emptive: if strong solar tomorrow, SET_CHARGE_LIMIT to targetSoC.
//   The simulated SoC is carried forward slot-by-slot, so each decision
//   accounts for the cumulative effect of all prior slots.

class SmartEcoStrategy {
  get id()   { return 'smart-eco'; }
  get name() { return 'Smart Eco'; }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Extract nightly profile from config with safe defaults.
   * Profile is written by aggregatorService at 02:00 each day.
   */
  _getProfile(config) {
    const p = config.nightlyProfile ?? {};

    // Guard: an hourly profile that's missing, wrong-length, or all zeros
    // (e.g. aggregator ran against broken load data) would make the SoC
    // simulation model a house that consumes nothing. Fall back to a flat
    // 300W baseline in that case. The caller can detect the fallback via
    // `source === 'fallback'` and replace it with a history-derived profile.
    let hourly = p.hourlyLoadProfile;
    let source = 'config';
    const hourlySum = Array.isArray(hourly)
      ? hourly.reduce((s, w) => s + (Number(w) || 0), 0)
      : 0;
    if (!Array.isArray(hourly) || hourly.length !== 24 || hourlySum < 24) {
      hourly = Array(24).fill(300);
      source = 'fallback';
    }

    return {
      morningKwhNeeded:       p.morningKwhNeeded       ?? 3.0,
      solarStartHour:         p.solarStartHour         ?? 9,
      solarTotalKwh:          p.solarTotalKwh          ?? 0,
      forecastAccuracyFactor: p.forecastAccuracyFactor ?? 1.5,
      dailyAvgLoadKwh:        p.dailyAvgLoadKwh        ?? 5.0,
      hourlyLoadProfile:      hourly,
      hourlyLoadProfileSource: source,
    };
  }

  /**
   * Compute an hourly load profile (24 × watts) from recent history.
   *
   * `load_power` in `energy_snapshots` is 100% NULL in this deployment — no
   * collector writes that column directly. Each source writes only the
   * fields it owns and NULL for the rest:
   *   • alphaess-modbus-tcp → battery_power, grid_power
   *   • solaredge-modbus    → solar_power
   *   • homewizard          → voltage/current/frequency only
   * So no single row has all three power components populated.
   *
   * We derive load by bucketing all rows per hour-of-day, taking AVG of each
   * column separately (SQL's AVG ignores NULL — so each average reflects the
   * source that owns that column), then applying the load formula on the
   * bucket averages:
   *
   *     load = max(0, avg_solar + avg_battery + avg_grid)
   *
   * Sign convention in this hardware (verified empirically on 2026-06-09):
   *   • solar_power   > 0 when producing
   *   • battery_power > 0 when DISCHARGING   (note: opposite of "charging-positive")
   *   • grid_power    > 0 when IMPORTING
   * Under this convention the formula above is consistent: discharging
   * battery and grid import both add to load; solar adds to load too, since
   * any solar produced must be going somewhere (load, battery, or export).
   * If battery is charging or grid is exporting their values are negative
   * and the sum can be < 0, which we clamp to 0 (impossible "negative load").
   *
   * Hours with fewer than 5 contributing rows are treated as unreliable and
   * the whole profile is rejected — better to fall back to the flat 300W
   * than mislead the simulation with a half-baked profile.
   *
   * Returns a 24-element array of watts, or null on failure / insufficient
   * data.
   *
   * This is a stopgap. The long-term solution is for aggregatorService to
   * write `nightlyProfile.hourlyLoadProfile` correctly; once it does, the
   * `source === 'fallback'` branch in generateFullDayPlan stops firing and
   * this helper is never called.
   */
  async _loadHourlyProfileFromHistory(daysBack = 14) {
    try {
      const { default: db } = await import('../database.js');

      // Bucket by local hour-of-day, average each column independently across
      // whichever sources contributed. AVG() ignores NULL in SQLite, so each
      // average reflects only the source that owns that column.
      const [rows] = await db.pool.query(
        `SELECT
           CAST(strftime('%H', timestamp) AS INTEGER) AS hour,
           AVG(solar_power)   AS avg_solar,
           AVG(battery_power) AS avg_battery,
           AVG(grid_power)    AS avg_grid,
           COUNT(*)           AS samples
         FROM energy_snapshots
         WHERE timestamp >= datetime('now', '-' || ? || ' days')
         GROUP BY hour`,
        [daysBack]
      );

      if (!rows || rows.length < 24) {
        return null;
      }

      const profile = Array(24).fill(null);
      for (const r of rows) {
        if (Number(r.samples) < 5) continue;

        const s = parseFloat(r.avg_solar)   || 0;
        const b = parseFloat(r.avg_battery) || 0;
        const g = parseFloat(r.avg_grid)    || 0;
        const load = Math.max(0, s + b + g);

        profile[Number(r.hour)] = Math.round(load);
      }

      if (profile.some(v => v === null)) {
        return null;
      }

      return profile;
    } catch (e) {
      console.warn(`   • Strategy-Manager          - SmartEco _loadHourlyProfileFromHistory failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Find the lowest-price window before a given hour cutoff.
   * Returns { hour, price } or null.
   */
  _cheapestWindowBefore(prices, beforeHour) {
    const candidates = prices.filter(p => p.hour < beforeHour);
    if (!candidates.length) return null;
    return candidates.reduce((best, p) => p.price < best.price ? p : best);
  }

  /**
   * Check whether any upcoming prices (within the next `lookAheadHours`)
   * are at or below threshold.
   */
  _hasNegativePricesAhead(prices, currentHour, lookAheadHours, threshold) {
    return prices.some(
      p => p.hour >= currentHour &&
           p.hour <  currentHour + lookAheadHours &&
           p.price <= threshold
    );
  }

  /**
   * Check if current hour is among the cheapest two windows before solar starts.
   */
  _isGoodChargingWindow(prices, currentHour, solarStartHour, currentPrice) {
    const window = prices.filter(p => p.hour >= currentHour && p.hour < solarStartHour);
    if (window.length === 0) return false;
    const sorted = [...window].sort((a, b) => a.price - b.price);
    return sorted.slice(0, 2).some(p => p.hour === currentHour);
  }

  /**
   * Calculate total expected solar kWh within a lookahead window from nowMs.
   * Used by both decide() and generateFullDayPlan() for discharge decisions.
   */
  _solarKwhInWindow(solarForecast, fromMs, lookaheadHours) {
    const toMs       = fromMs + lookaheadHours * 60 * 60 * 1000;
    const slotHours  = 1 / 4; // each forecast entry = 1h
    return solarForecast
      .filter(f => {
        const t = f.datetime ? new Date(f.datetime).getTime() : null;
        return t && t >= fromMs && t < toMs;
      })
      .reduce((sum, f) => sum + (f.watts ?? 0) * slotHours / 1000, 0); // W → kWh
  }

  /**
   * Remaining solar kWh from forecast entries that are still in the future.
   * Replaces the static profile.solarTotalKwh for decisions that should
   * adapt as the day progresses (charge limit, strong-solar detection).
   * Each forecast entry represents 1 hour at the given wattage.
   */
  _remainingSolarKwh(solarForecast, fromMs = Date.now()) {
    return solarForecast
      .filter(f => {
        const t = f.datetime ? new Date(f.datetime).getTime() : null;
        return t && t >= fromMs;
      })
      .reduce((sum, f) => sum + (f.watts ?? 0) / 1000, 0);
  }

  /**
   * Compute the Nth percentile value from an array of prices.
   * Uses remaining prices (from currentHour onwards) so the threshold
   * reflects what's still ahead rather than the full day average.
   */
  _pricePercentile(prices, fromHour, percentile) {
    const remaining = prices
      .filter(p => p.hour >= fromHour && p.price != null)
      .map(p => p.price)
      .sort((a, b) => a - b);
    if (!remaining.length) return null;
    const idx = Math.floor((percentile / 100) * remaining.length);
    return remaining[Math.min(idx, remaining.length - 1)];
  }

  /**
   * Calculate the target charge limit SoC for tomorrow based on solar forecast.
   * Reserves enough headroom to absorb the expected solar production.
   *
   * targetSoC = 100% - (adjustedSolarKwh / batteryCapacityKwh * 100)
   * Floored at minSocPct + conservativeBufferPct to protect against forecast errors.
   *
   * @param {number} adjustedSolarKwh  Solar forecast adjusted for accuracy factor
   * @param {number} batteryCapacityKwh
   * @param {number} minSocPct
   * @param {number} conservativeBufferPct  Extra buffer above minSoc (default 20%)
   * @returns {number} targetSoC 0-100
   */
  _calcChargeLimitSoC(adjustedSolarKwh, batteryCapacityKwh, minSocPct, conservativeBufferPct = 20) {
    const headroomNeeded = (adjustedSolarKwh / batteryCapacityKwh) * 100;
    const target = Math.round(100 - headroomNeeded);
    const floor  = minSocPct + conservativeBufferPct;
    return Math.max(floor, Math.min(100, target));
  }

  async decide(context, config) {
    const {
      batteryCapacityKwh       = 11.2,
      minSocPct                = 20,
      chargePowerWatts         = 3000,
      negativePriceThreshold   = 0,
      solarSurplusThresholdKwh = 5,
      dischargeFloorCt         = 5.0,
      curtailmentSocTrigger    = 90,    // kept for alert only — curtailment trigger is soc >= 100
      curtailmentPricePercentile = 20,
      curtailmentSocStep         = 5,
      curtailmentLookaheadHours  = 2,
      dischargePercentile        = 90,
      dischargeLookaheadHours    = 2,
      dischargeSocMinPct         = 95,
      chargeLimitConservativePct = 20,  // buffer above minSoc for charge limit calculation
    } = config;

    const { soc, currentPrice, prices = [], solarForecast = [] } = context;
    const hour = new Date().getHours();

    // ── Guards ───────────────────────────────────────────────────────────────
    if (currentPrice === null) {
      return { action: 'IDLE', reason: 'No current price available — grid:pricing not ready' };
    }
    if (soc === null) {
      return { action: 'IDLE', reason: 'No battery SoC available — battery:read not ready' };
    }

    // ── Scenario 0: Solar curtailment risk alert ──────────────────────────────
    // Advisory alert only — fires when SoC is high, solar is incoming, prices cheap.
    // Tells users to run high-load appliances now. Does NOT override dispatch action.
    let curtailmentAlert = null;
    if (soc >= curtailmentSocTrigger && prices.length >= 5) {
      const sorted        = [...prices].map(p => p.price).filter(p => p != null).sort((a, b) => a - b);
      const percentileIdx = Math.floor((curtailmentPricePercentile / 100) * sorted.length);
      const priceFloor    = sorted[Math.max(0, percentileIdx - 1)] ?? 0;

      const nowMs        = Date.now();
      const lookaheadMs  = curtailmentLookaheadHours * 60 * 60 * 1000;
      const incomingSolarW = solarForecast
        .filter(f => {
          const fTime = f.datetime ? new Date(f.datetime).getTime() : null;
          return fTime && fTime >= nowMs && fTime < nowMs + lookaheadMs;
        })
        .reduce((sum, f) => sum + (f.watts ?? 0), 0) /
        Math.max(1, curtailmentLookaheadHours * 4);

      const solarExpected = incomingSolarW > 200;

      if (currentPrice <= priceFloor && solarExpected) {
        const socBracket = Math.floor(soc / curtailmentSocStep) * curtailmentSocStep;
        curtailmentAlert = {
          alertRequired: true,
          alert: {
            type:       `solar_curtailment_risk_${socBracket}`,
            severity:   'warning',
            message:    `Battery at ${soc}% with solar incoming and low prices (${currentPrice.toFixed(1)}ct ≤ ${curtailmentPricePercentile}th percentile). Consider running high-load appliances now.`,
            suggestion: `Solar will arrive soon but the battery is already ${soc}% full. Run dishwasher, washing machine, or EV charger now to use this cheap/free energy before it cannot be stored.`,
            action:     'USE_HIGH_LOAD',
          },
        };
      }
    }

    const profile    = this._getProfile(config);
    const currentKwh = (soc / 100) * batteryCapacityKwh;
    const minKwh     = (minSocPct / 100) * batteryCapacityKwh;
    const usableKwh  = currentKwh - minKwh;

    // Remaining solar from now onward — adapts as the day progresses
    const remainingSolarKwh = this._remainingSolarKwh(solarForecast);
    const adjustedSolarKwh  = remainingSolarKwh * profile.forecastAccuracyFactor;
    const isStrongSolar     = adjustedSolarKwh >= solarSurplusThresholdKwh;

    // How many kWh are needed from NOW until solar starts producing?
    const hoursUntilSolar = hour < profile.solarStartHour
      ? profile.solarStartHour - hour
      : (24 - hour) + profile.solarStartHour;

    const energyNeededKwh = Array.from({ length: hoursUntilSolar }, (_, i) =>
      profile.hourlyLoadProfile[(hour + i) % 24]
    ).reduce((sum, w) => sum + w / 1000, 0);

    const gapKwh = Math.max(0, energyNeededKwh - usableKwh);

    // ── Scenario 1: Negative price — self-consumption priority ───────────────
    // Core philosophy: during negative prices, the grid has surplus.
    // We never charge from grid (that wastes the surplus problem).
    // If battery is full AND solar is generating → curtail solar (stop exporting).
    // If battery is not full → IDLE, let solar fill the battery naturally.
    if (currentPrice <= negativePriceThreshold) {
      const batteryFull = soc >= 99; // treat 99%+ as effectively full

      if (batteryFull) {
        // Battery can't absorb more — curtail solar to stop forced export
        return {
          action: 'CURTAIL_SOLAR',
          curtail: true,
          reason:  `Negative price (${currentPrice.toFixed(1)}ct) and battery full (${soc}%). Curtailing solar to stop grid export.`,
          alertRequired: true,
          alert: {
            type:       'negative_price_curtail',
            severity:   'info',
            message:    `Battery full at ${soc}% and prices are negative (${currentPrice.toFixed(1)}ct). Solar export stopped.`,
            suggestion: `Solar will resume automatically when price recovers or battery discharges.`,
            action:     'SOLAR_CURTAILED',
          },
        };
      } else {
        // Battery still has room — solar is filling it, let it run
        return {
          action: 'IDLE',
          reason: `Negative price (${currentPrice.toFixed(1)}ct) — solar charging battery (${soc}%). No grid charging.`,
          ...curtailmentAlert,
        };
      }
    }

    // ── Price is positive from here on — consider restoring curtailment ───────
    // Note: actual curtailment restore is handled by _evaluateCurtailment()
    // in strategyManager. decide() does not need to send CURTAIL_SOLAR = false.

    // ── Scenario 1.5: Strong solar forecast — set charge limit ───────────────
    // When solar is expected to be strong tomorrow, cap the battery SoC now
    // so there is room to absorb solar production without forced export.
    // Uses Charge Cut SoC register (0x0855) — inverter enforces natively.
    // Only fires at night (after solar has stopped) to avoid interfering with
    // daytime solar charging.
    const isNight = hour >= 20 || hour < profile.solarStartHour;
    if (isNight && isStrongSolar) {
      const targetSoC = this._calcChargeLimitSoC(
        adjustedSolarKwh,
        batteryCapacityKwh,
        minSocPct,
        chargeLimitConservativePct
      );

      // Only act if battery is currently above target (needs to discharge or limit)
      if (soc > targetSoC + 5) {
        return {
          action:        'SET_CHARGE_LIMIT',
          chargeLimitPct: targetSoC,
          reason:        `Strong solar forecast (${adjustedSolarKwh.toFixed(1)} kWh adjusted). Setting charge limit to ${targetSoC}% to reserve headroom for solar absorption.`,
          ...curtailmentAlert,
        };
      }
    }

    // When solar is weak, restore charge limit to 100%
    if (isNight && !isStrongSolar) {
      return {
        action:        'SET_CHARGE_LIMIT',
        chargeLimitPct: 100,
        reason:        `Weak solar forecast (${adjustedSolarKwh.toFixed(1)} kWh). Charge limit restored to 100%.`,
        ...curtailmentAlert,
      };
    }

    // ── Scenario 2.5: Peak price + solar incoming — discharge to make room ────
    {
      const dischargeThreshold = this._pricePercentile(prices, hour, dischargePercentile);
      const nowMs              = Date.now();
      const solarInWindowKwh   = this._solarKwhInWindow(solarForecast, nowMs, dischargeLookaheadHours);
      const solarIsComing      = solarInWindowKwh > 0.5;
      const solarIsImminent    = hour >= (profile.solarStartHour - dischargeLookaheadHours)
                              && hour <   profile.solarStartHour;
      const aboveSocMin        = soc >= dischargeSocMinPct;
      const headroomKwh        = currentKwh - minKwh;
      const isPeakPrice        = dischargeThreshold !== null && currentPrice >= dischargeThreshold;
      const aboveFloor         = currentPrice >= dischargeFloorCt;

      if (isPeakPrice && aboveFloor && solarIsComing && solarIsImminent && aboveSocMin && headroomKwh > 0.5) {
        const dischargeKwh = Math.min(solarInWindowKwh, headroomKwh);
        const targetSoc    = Math.max(
          minSocPct,
          Math.floor(((currentKwh - dischargeKwh) / batteryCapacityKwh) * 100)
        );

        return {
          action:        'DISCHARGE_TO_GRID',
          reason:        `Peak price (${currentPrice.toFixed(1)}ct ≥ ${dischargePercentile}th percentile ${dischargeThreshold.toFixed(1)}ct). Solar forecast ${solarInWindowKwh.toFixed(2)} kWh in next ${dischargeLookaheadHours}h — discharging ${dischargeKwh.toFixed(2)} kWh to make room.`,
          power:         chargePowerWatts,
          targetSoc,
          durationHours: Math.max(0.25, dischargeKwh / (chargePowerWatts / 1000)),
          ...curtailmentAlert,
        };
      }
    }

    // ── Scenario 3: No morning gap — solar will cover it ─────────────────────
    if (gapKwh === 0) {
      return {
        action: 'IDLE',
        reason: `Battery has sufficient charge (${usableKwh.toFixed(1)} kWh usable) to cover ${hoursUntilSolar}h until solar (${energyNeededKwh.toFixed(1)} kWh needed). No charging needed.`,
        ...curtailmentAlert,
      };
    }

    // ── Scenario 4: Gap exists but solar will more than cover it ─────────────
    if (adjustedSolarKwh > gapKwh * 1.3 && hour < profile.solarStartHour) {
      return {
        action: 'IDLE',
        reason: `Need ${energyNeededKwh.toFixed(1)} kWh over next ${hoursUntilSolar}h but solar forecast (${adjustedSolarKwh.toFixed(1)} kWh adjusted) will cover the gap. Waiting for solar.`,
        ...curtailmentAlert,
      };
    }

    // ── Scenario 5: Gap exists, solar won't cover it, now is cheapest window ──
    // Winter / weak solar: grid charging is appropriate here.
    if (
      gapKwh > 0 &&
      hour < profile.solarStartHour &&
      this._isGoodChargingWindow(prices, hour, profile.solarStartHour, currentPrice)
    ) {
      const chargeKw      = chargePowerWatts / 1000;
      const durationHours = Math.max(1, Math.ceil(gapKwh / chargeKw));
      const targetSoc     = Math.min(
        100,
        Math.ceil(((currentKwh + gapKwh) / batteryCapacityKwh) * 100)
      );

      return {
        action:        'CHARGE_FROM_GRID',
        reason:        `Gap of ${gapKwh.toFixed(1)} kWh. Current price ${currentPrice}ct is cheapest available window before solar (h${profile.solarStartHour}). Charging.`,
        power:         chargePowerWatts,
        targetSoc,
        durationHours,
      };
    }

    // ── Scenario 6: Gap exists but prices are high now — wait ────────────────
    if (gapKwh > 0 && gapKwh < 2 && adjustedSolarKwh > 0) {
      return {
        action: 'IDLE',
        reason: `Small gap (${gapKwh.toFixed(1)} kWh), price high (${currentPrice}ct), solar forecast present. Waiting for cheaper window or solar.`,
        ...curtailmentAlert,
      };
    }

    // ── Scenario 7: Large gap, no good price window, no solar — charge anyway ─
    if (gapKwh >= 2) {
      const chargeKw      = chargePowerWatts / 1000;
      const durationHours = Math.max(1, Math.ceil(gapKwh / chargeKw));
      const targetSoc     = Math.min(
        100,
        Math.ceil(((currentKwh + gapKwh) / batteryCapacityKwh) * 100)
      );

      return {
        action:        'CHARGE_FROM_GRID',
        reason:        `Large gap of ${gapKwh.toFixed(1)} kWh and no better price window available. Charging now at ${currentPrice}ct.`,
        power:         chargePowerWatts,
        targetSoc,
        durationHours,
      };
    }

    return {
      action: 'IDLE',
      reason: 'Price and SoC within normal range — self-consumption mode.',
      ...curtailmentAlert,
    };
  }

  // ── Day Plan (slot-by-slot SoC simulation) ────────────────────────────────
  //
  // Called hourly by strategyManager.regenerateDayPlan().
  // Produces 96 × 15-min slots covering the next 24h rolling window.
  //
  // SoC simulation rules per slot:
  //   1. Solar covers home load first. Any surplus charges the battery.
  //   2. Remaining load (after solar) is drawn from the battery.
  //   3. If post-draw SoC would breach minSocPct AND solar is weak → CHARGE_FROM_GRID.
  //   4. Negative price + battery at charge limit → SOLAR_CURTAIL.
  //   5. Negative price + battery has room → IDLE (solar filling battery).
  //   6. Solar surplus and battery already at charge limit → SOLAR_SURPLUS.
  //   7. All other cases → IDLE (self-consumption).
  //
  // Each slot stores simSocPct so the frontend can optionally render a
  // battery trajectory overlay on the timeline.
  //
  // Per-slot energy ledger (kWh, added v1.5):
  //   simLoadKwh        — house demand this slot
  //   simSolarKwh       — solar production this slot (raw, before curtail)
  //   simGridImportKwh  — energy drawn from grid this slot
  //   simGridExportKwh  — energy sent to grid this slot
  //
  // Derivation: solar + gridImport = load + batteryNetCharge + gridExport
  //   → gridFlow (signed) = load + socDelta - solar
  //   → gridImport = max(0, gridFlow), gridExport = max(0, -gridFlow)
  //
  // Special case: SOLAR_CURTAIL physically clips solar to load.
  //   → gridImport = 0, gridExport = 0.
  //
  // No round-trip losses are modeled — kept in lockstep with the existing
  // simSocKwh math which also assumes 100% efficiency. PR 2 may add losses
  // uniformly to both the SoC trajectory and the new flow fields.
  //
  // v1.6 fix: charge limit only constrains grid charging, not solar.
  // Solar always charges to full physical capacity. SOLAR_CURTAIL only
  // fires when battery is truly full (>= batteryCapacityKwh - 0.1).
  // (matching SOLAR_SURPLUS precondition) instead of `simSocPct >= 99`.
  // On strong-solar days where chargeLimitSoC < 99, the previous condition
  // never fired and the simulator would silently model export at negative
  // prices instead of curtailment.

  async generateFullDayPlan(context, config) {
    const {
      batteryCapacityKwh       = 11.2,
      minSocPct                = 20,
      chargePowerWatts         = 3000,
      negativePriceThreshold   = 0,
      solarSurplusThresholdKwh = 5,
      dischargeFloorCt         = 5.0,
      dischargePercentile      = 80,
      dischargeLookaheadHours  = 2,
      dischargeSocMinPct       = 80,
      chargeLimitConservativePct = 20,
    } = config;

    const { prices = [], solarForecast = [], soc: currentSoc = 50 } = context;
    const windowHours = context.windowHours ?? 24;
    const windowStart = context.windowStart
      ? new Date(context.windowStart)
      : new Date();

    const profile = this._getProfile(config);

    // If _getProfile returned the flat 300W fallback (config didn't have a
    // usable hourlyLoadProfile), try to derive one from the last 14 days of
    // snapshots. The result is a better starting point for the SoC simulation
    // and reflects the user's actual consumption pattern instead of a guess.
    if (profile.hourlyLoadProfileSource === 'fallback') {
      const historicProfile = await this._loadHourlyProfileFromHistory(14);
      if (historicProfile) {
        profile.hourlyLoadProfile = historicProfile;
        profile.hourlyLoadProfileSource = 'history-14d';
      }
    }

    // Unconditional diagnostic: which profile is the simulation using, and
    // what's the daily average? If this line never appears in the log, the
    // day plan code path isn't actually running.
    {
      const avgW = Math.round(
        profile.hourlyLoadProfile.reduce((s, w) => s + w, 0) / 24
      );
      console.log(
        `   • Strategy-Manager          - SmartEco day plan: ` +
        `load profile source=${profile.hourlyLoadProfileSource}, avg=${avgW}W/h`
      );
      console.log(
        `   • Strategy-Manager          - hourly load W: ` +
        `[${profile.hourlyLoadProfile.map((w, i) => `${i}:${w}`).join(', ')}]`
      );
    }

    // Physical constants
    const minKwh          = (minSocPct / 100) * batteryCapacityKwh;
    const slotHours       = 0.25;
    const chargeKwPerSlot = (chargePowerWatts / 1000) * slotHours;

    // Solar forecast strength — remaining solar within the plan window
    const remainingSolarKwh = this._remainingSolarKwh(solarForecast, windowStart.getTime());
    const adjustedSolarKwh  = remainingSolarKwh * profile.forecastAccuracyFactor;
    const isStrongSolar     = adjustedSolarKwh >= solarSurplusThresholdKwh;

    // Charge limit for the day plan simulation
    // If strong solar, cap simulated charging at targetSoC to model realistic behaviour
    const chargeLimitSoC = isStrongSolar
      ? this._calcChargeLimitSoC(adjustedSolarKwh, batteryCapacityKwh, minSocPct, chargeLimitConservativePct)
      : 100;
    const chargeLimitKwh = (chargeLimitSoC / 100) * batteryCapacityKwh;

    // ── Local datetime key helpers ────────────────────────────────────────────
    // All slot/price/solar keys MUST be in local time. Source datetimes vary
    // (DB: "2026-06-10 21:45:00" local; pricing handler: ISO/UTC strings), so
    // parse with new Date() and re-key via getHours()/getMinutes() — both
    // formats then land on the same local key.
    const _pad2 = n => String(n).padStart(2, '0');

    const _localHourKey = (d) =>
      `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}T${_pad2(d.getHours())}`;

    // Same idea but at 15-min resolution — used for slot/price matching.
    const _localSlotKey = (d) =>
      `${_localHourKey(d)}:${_pad2(d.getMinutes())}`;

    // ── Index prices by 15-min LOCAL datetime key (YYYY-MM-DDTHH:MM) ─────────
    const priceBySlot = {};
    for (const p of prices) {
      if (!p.datetime) continue;
      const d = new Date(p.datetime);
      if (!isNaN(d)) priceBySlot[_localSlotKey(d)] = p.price;
    }

    const solarByHour = {};
    for (const f of solarForecast) {
      if (f.datetime) {
        const d = new Date(f.datetime);
        solarByHour[_localHourKey(d)] = f.watts ?? 0;
      } else if (f.hour !== undefined) {
        const base = new Date(windowStart);
        base.setHours(f.hour, 0, 0, 0);
        solarByHour[_localHourKey(base)] = f.watts ?? 0;
      }
    }


    // ── Pre-compute per-slot solar lookahead budget ───────────────────────────
    const solarLookaheadKwh = {};
    const lookaheadSlotCount = dischargeLookaheadHours * 4;
    const totalSlots = windowHours * 4;

    for (let i = 0; i < totalSlots; i++) {
      let solarAhead = 0;
      for (let j = i; j < Math.min(i + lookaheadSlotCount, totalSlots); j++) {
        const t   = new Date(windowStart.getTime() + j * 15 * 60 * 1000);
        const key = _localHourKey(t);
        solarAhead += (solarByHour[key] ?? 0) * slotHours / 1000;
      }
      solarLookaheadKwh[i] = solarAhead;
    }
    console.log(
      `   • Strategy-Manager        - SmartEco day plan: ` +
      `solar in window: ${remainingSolarKwh.toFixed(2)} kWh raw, ` +
      `×${profile.forecastAccuracyFactor} = ${adjustedSolarKwh.toFixed(2)} kWh adjusted, ` +
      `isStrongSolar=${isStrongSolar}, chargeLimitSoC=${chargeLimitSoC}%`
    );
    // ── SoC simulation — starts from current real SoC ─────────────────────────
    let simSocKwh = ((currentSoc ?? 50) / 100) * batteryCapacityKwh;

    // Parallel "unconstrained" trajectory: same load/solar inputs, but charging
    // is capped at physical capacity instead of the charge limit. This is what
    // the user-facing chart plots, because it answers "when will SoC reach
    // 100%" — the planning question. The constrained `simSocKwh` above is
    // retained for action decisions and the grid-flow ledger.
    let simSocKwhUnconstrained = simSocKwh;

    // Track the first slot where unconstrained SoC reaches ≥99%, and the
    // cumulative solar surplus from that point forward (the "dishwasher
    // budget" — kWh that would otherwise be exported).
    let socFullSlotIndex      = -1;
    let surplusAfterFullKwh   = 0;
    let socFloorSlotIndex     = -1;

    const plan = [];

    for (let i = 0; i < totalSlots; i++) {
      const slotTime = new Date(windowStart.getTime() + i * 15 * 60 * 1000);
      const hour     = slotTime.getHours();
      const minute   = slotTime.getMinutes();
      const datetime = _localSlotKey(slotTime);
      const hourKey  = _localHourKey(slotTime);

      const price  = priceBySlot[datetime] ?? null;
      const solarW = (solarByHour[hourKey] ?? 0) * (profile.forecastAccuracyFactor || 2.0);

      // ── Per-slot energy flows (kWh) ─────────────────────────────────────────
      const loadKwh         = (profile.hourlyLoadProfile[hour] ?? 300) * slotHours / 1000;
      const solarKwh        = (solarW * slotHours) / 1000;
      const netLoadKwh      = Math.max(0, loadKwh - solarKwh);
      const solarSurplusKwh = Math.max(0, solarKwh - loadKwh);

      // Solar always charges to full physical capacity — charge limit only gates grid charging
      const batteryRoomKwh    = batteryCapacityKwh - simSocKwh;
      const solarChargeKwh    = Math.min(solarSurplusKwh, Math.max(0, batteryRoomKwh));
      const projectedSocKwh   = simSocKwh - netLoadKwh + solarChargeKwh;

      // v1.5: capture SoC before this slot's update for grid-flow ledger
      const simSocKwhBefore   = simSocKwh;

      let action = 'IDLE';
      let watts  = 0;
      let reason = 'Self-consumption';
      let alert  = null;

      if (price !== null) {
        const isNegative = price <= negativePriceThreshold;

        const remainingPrices = Object.entries(priceBySlot)
          .filter(([dt]) => dt >= datetime)
          .map(([, p]) => p)
          .filter(p => p != null)
          .sort((a, b) => a - b);
        const pctIdx             = Math.floor((dischargePercentile / 100) * remainingPrices.length);
        const dischargeThreshold = remainingPrices.length
          ? remainingPrices[Math.min(pctIdx, remainingPrices.length - 1)]
          : null;

        const isPeak        = dischargeThreshold !== null && price >= dischargeThreshold;
        const aboveFloor    = price >= dischargeFloorCt;
        const solarAhead    = solarLookaheadKwh[i] ?? 0;
        const solarIsComing = solarAhead > 0.5;
        const solarIsImminent = hour >= (profile.solarStartHour - dischargeLookaheadHours)
                             && hour <   profile.solarStartHour;
        const simSocPct     = (simSocKwh / batteryCapacityKwh) * 100;
        const aboveSocMin   = simSocPct >= dischargeSocMinPct;
        const headroomKwh   = simSocKwh - minKwh;
        const batteryFull   = simSocPct >= 99;

        if (isNegative) {
          // Curtail only when battery is truly full — charge limit doesn't restrict solar
          const atFullCapacity = simSocKwh >= batteryCapacityKwh - 0.1;

          if (atFullCapacity && solarW > 50) {
            // ── Negative price + battery full + solar generating → curtail
            action = 'SOLAR_CURTAIL';
            reason = `Negative price (${price.toFixed(1)}ct) and battery full (${simSocPct.toFixed(0)}%). Solar curtailed to stop grid export.`;
            alert  = 'negative_price_curtail';
            // Curtailment clips solar to load — no grid export.
            // If load > solar, battery still covers the deficit (drains).
            const curtailDeficitKwh = Math.max(0, loadKwh - solarKwh);
            simSocKwh = Math.max(minKwh, simSocKwhBefore - curtailDeficitKwh);
          } else {
            // ── Negative price + battery has room → IDLE, solar fills battery ───
            action = 'IDLE';
            reason = `Negative price (${price.toFixed(1)}ct) — solar charging battery (${simSocPct.toFixed(0)}%). No grid charging.`;
            alert  = 'negative_price';
            // Solar charges battery to full physical capacity.
            simSocKwh = Math.min(batteryCapacityKwh, Math.max(minKwh, projectedSocKwh));
          }

        } else if (projectedSocKwh < minKwh && !isStrongSolar) {
          // ── SoC would breach floor AND solar is weak: charge from grid ────────
          // Only charge from grid in winter / weak solar conditions.
          // When solar is strong, the battery will fill naturally — don't interfere.
          // Charge limit applies here — don't grid-charge above the limit.
          const chargeKwh = Math.min(chargeKwPerSlot, chargeLimitKwh - projectedSocKwh);
          action = 'CHARGE_FROM_GRID';
          watts  = chargePowerWatts;
          reason = `Projected SoC would drop to ${((projectedSocKwh / batteryCapacityKwh) * 100).toFixed(0)}% ` +
                   `(weak solar day). Charging ${chargeKwh.toFixed(2)} kWh at ${price.toFixed(1)}ct.`;
          simSocKwh = Math.min(chargeLimitKwh, projectedSocKwh + chargeKwh);

        } else if (isPeak && aboveFloor && solarIsComing && solarIsImminent && aboveSocMin && headroomKwh > 0.5) {
          // ── Peak price + solar incoming: discharge only to make room ─────────
          const dischargeKwh = Math.min(
            chargeKwPerSlot,
            Math.min(solarAhead, headroomKwh)
          );

          if (dischargeKwh > 0.01) {
            action = 'DISCHARGE_TO_GRID';
            watts  = chargePowerWatts;
            reason = `Peak price (${price.toFixed(1)}ct ≥ ${dischargePercentile}th pct ${dischargeThreshold.toFixed(1)}ct). ` +
                     `${solarAhead.toFixed(2)} kWh solar in next ${dischargeLookaheadHours}h — discharging ${dischargeKwh.toFixed(2)} kWh to make room.`;
            simSocKwh = Math.max(minKwh, projectedSocKwh - dischargeKwh);
          } else {
            simSocKwh = Math.min(batteryCapacityKwh, Math.max(minKwh, projectedSocKwh));
          }

        } else if (solarSurplusKwh > 0 && simSocKwh >= batteryCapacityKwh - 0.1) {
          // ── Solar surplus, battery full ────────────────────────────────────────
          action = 'SOLAR_SURPLUS';
          watts  = solarW;
          reason = `${(solarW / 1000).toFixed(1)} kW solar surplus — battery full (${simSocPct.toFixed(0)}%), energy exported or used directly.`;
          // Battery can't absorb (full); surplus is exported.
          // SoC stays where it is.
          simSocKwh = simSocKwhBefore;

        } else {
          // ── Normal self-consumption ─────────────────────────────────────────
          // Ceiling is physical capacity; the charge limit only constrains
          // charging (already applied in solarChargeKwh above).
          simSocKwh = Math.min(batteryCapacityKwh, Math.max(minKwh, projectedSocKwh));
        }

      } else {
        simSocKwh = Math.min(batteryCapacityKwh, Math.max(0, projectedSocKwh));
      }

      // Hard clamp
      simSocKwh = Math.max(0, Math.min(batteryCapacityKwh, simSocKwh));

      // ── Unconstrained trajectory ────────────────────────────────────────────
      // Same load/solar inputs, ceiling is physical capacity (no charge limit).
      // This drives the user-facing prediction chart.
      const roomUnconstrainedKwh = batteryCapacityKwh - simSocKwhUnconstrained;
      const solarChargeUnconstrainedKwh = Math.min(solarSurplusKwh, Math.max(0, roomUnconstrainedKwh));
      simSocKwhUnconstrained = Math.max(0, Math.min(
        batteryCapacityKwh,
        simSocKwhUnconstrained - netLoadKwh + solarChargeUnconstrainedKwh
      ));

      const simSocPctUnconstrained = Math.round((simSocKwhUnconstrained / batteryCapacityKwh) * 100);

      // First slot where unconstrained SoC hits the floor — grid takes over
      if (socFloorSlotIndex < 0 && simSocPctUnconstrained <= minSocPct) {
        socFloorSlotIndex = i;
      }

      // First slot to reach ≥99% in the unconstrained trajectory: that's when
      // free solar capacity starts flowing — the actionable insight.
      if (socFullSlotIndex < 0 && simSocPctUnconstrained >= 99) {
        socFullSlotIndex = i;
      }
      // After the battery is "full", accumulate the surplus that would have
      // gone to charging if there were room — i.e. solar minus what fit.
      if (socFullSlotIndex >= 0) {
        const unabsorbedKwh = solarSurplusKwh - solarChargeUnconstrainedKwh;
        if (unabsorbedKwh > 0) surplusAfterFullKwh += unabsorbedKwh;
      }

      // ── v1.5: Per-slot grid-flow ledger ─────────────────────────────────────
      // Energy ledger: solar + gridImport = load + socDelta + gridExport
      //   → gridFlow = load + socDelta - solar (signed; +import / -export)
      // Special case: SOLAR_CURTAIL physically clips solar to load.
      //   → gridImport = 0, gridExport = 0 (no grid involvement).
      let simGridImportKwh = 0;
      let simGridExportKwh = 0;
      if (action === 'SOLAR_CURTAIL') {
        // gridImport = gridExport = 0 (already initialized)
      } else {
        const socDelta = simSocKwh - simSocKwhBefore;
        const gridFlow = loadKwh + socDelta - solarKwh;
        simGridImportKwh = Math.max(0, gridFlow);
        simGridExportKwh = Math.max(0, -gridFlow);
      }

      // Dev-mode sanity check: import and export must not both be positive in
      // the same slot. Catches sign bugs in the derivation above.
      if (process.env.NODE_ENV !== 'production'
          && simGridImportKwh > 0.001
          && simGridExportKwh > 0.001) {
        console.warn(
          `   • SmartEco day plan: slot ${i} (${datetime}) action=${action} ` +
          `has both gridImport=${simGridImportKwh.toFixed(3)} and ` +
          `gridExport=${simGridExportKwh.toFixed(3)} — derivation bug?`
        );
      }

      plan.push({
        slot:           i,
        datetime,
        hour,
        minute,
        action,
        watts,
        reason,
        priceCtKwh:     price,
        solarForecastW: solarW,
        simSocPct:      Math.round((simSocKwh / batteryCapacityKwh) * 100),
        simSocPctUnconstrained,
        // v1.5: per-slot energy flows in kWh (3 decimals)
        simLoadKwh:        Math.round(loadKwh        * 1000) / 1000,
        simSolarKwh:       Math.round(solarKwh       * 1000) / 1000,
        simGridImportKwh:  Math.round(simGridImportKwh * 1000) / 1000,
        simGridExportKwh:  Math.round(simGridExportKwh * 1000) / 1000,
        alert,
      });
    }

    // ── Stamp the "battery full" marker on the relevant slot ─────────────────
    // Frontend can scan for isSocFullSlot to render the "100% reached at"
    // annotation, and read simSurplusAfterFullKwh as the high-load budget.
    if (socFullSlotIndex >= 0) {
      plan[socFullSlotIndex].isSocFullSlot          = true;
      plan[socFullSlotIndex].simSurplusAfterFullKwh = Math.round(surplusAfterFullKwh * 100) / 100;
    }

    // ── Stamp the "battery at floor" marker on the relevant slot ────────────
    // Frontend renders a persistent warning when SoC hits the floor and the
    // house switches to grid power.
    if (socFloorSlotIndex >= 0) {
      plan[socFloorSlotIndex].isSocFloorSlot = true;
      plan[socFloorSlotIndex].socFloorPct    = minSocPct;
    }

    return plan;
  }
}

export default new SmartEcoStrategy();