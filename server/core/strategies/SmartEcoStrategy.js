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
    return {
      morningKwhNeeded:       p.morningKwhNeeded       ?? 3.0,
      solarStartHour:         p.solarStartHour         ?? 9,
      solarTotalKwh:          p.solarTotalKwh          ?? 0,
      forecastAccuracyFactor: p.forecastAccuracyFactor ?? 0.7,
      dailyAvgLoadKwh:        p.dailyAvgLoadKwh        ?? 5.0,
      hourlyLoadProfile:      p.hourlyLoadProfile      ?? Array(24).fill(300),
    };
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

    // Apply forecast accuracy factor to solar estimate
    const adjustedSolarKwh = profile.solarTotalKwh * profile.forecastAccuracyFactor;
    const isStrongSolar    = adjustedSolarKwh >= solarSurplusThresholdKwh;

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
  // v1.5 fix: SOLAR_CURTAIL trigger now uses `simSocKwh >= effectiveCapacity`
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

    // Physical constants
    const minKwh          = (minSocPct / 100) * batteryCapacityKwh;
    const slotHours       = 0.25;
    const chargeKwPerSlot = (chargePowerWatts / 1000) * slotHours;

    // Solar forecast strength for this window
    const adjustedSolarKwh = profile.solarTotalKwh * profile.forecastAccuracyFactor;
    const isStrongSolar    = adjustedSolarKwh >= solarSurplusThresholdKwh;

    // Charge limit for the day plan simulation
    // If strong solar, cap simulated charging at targetSoC to model realistic behaviour
    const chargeLimitSoC = isStrongSolar
      ? this._calcChargeLimitSoC(adjustedSolarKwh, batteryCapacityKwh, minSocPct, chargeLimitConservativePct)
      : 100;
    const chargeLimitKwh = (chargeLimitSoC / 100) * batteryCapacityKwh;

    // ── Index prices by 15-min datetime key (YYYY-MM-DDTHH:MM) ───────────────
    const priceBySlot = {};
    for (const p of prices) {
      if (p.datetime) priceBySlot[p.datetime.slice(0, 16)] = p.price;
    }

    // ── Index solar forecast by LOCAL hour key ────────────────────────────────
    const _localHourKey = (d) => {
      const yyyy = d.getFullYear();
      const mm   = String(d.getMonth() + 1).padStart(2, '0');
      const dd   = String(d.getDate()).padStart(2, '0');
      const hh   = String(d.getHours()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}T${hh}`;
    };

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

    // ── SoC simulation — starts from current real SoC ─────────────────────────
    let simSocKwh = ((currentSoc ?? 50) / 100) * batteryCapacityKwh;

    const plan = [];

    for (let i = 0; i < totalSlots; i++) {
      const slotTime = new Date(windowStart.getTime() + i * 15 * 60 * 1000);
      const hour     = slotTime.getHours();
      const minute   = slotTime.getMinutes();
      const datetime = slotTime.toISOString().slice(0, 16);
      const hourKey  = _localHourKey(slotTime);

      const price  = priceBySlot[datetime] ?? null;
      const solarW = solarByHour[hourKey]  ?? 0;

      // ── Per-slot energy flows (kWh) ─────────────────────────────────────────
      const loadKwh         = (profile.hourlyLoadProfile[hour] ?? 300) * slotHours / 1000;
      const solarKwh        = (solarW * slotHours) / 1000;
      const netLoadKwh      = Math.max(0, loadKwh - solarKwh);
      const solarSurplusKwh = Math.max(0, solarKwh - loadKwh);

      // Battery room respects charge limit
      const effectiveCapacity = Math.min(batteryCapacityKwh, chargeLimitKwh);
      const batteryRoomKwh    = effectiveCapacity - simSocKwh;
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
          // v1.5 fix: trigger curtailment when battery is at the *charge limit*,
          // not at 99% SoC. On strong-solar days chargeLimitSoC can be 80% or
          // lower; the old `batteryFull` check (line below, kept for the reason
          // string) never fired and the simulator silently modeled export at
          // negative prices.
          const atChargeLimit = simSocKwh >= effectiveCapacity - 0.1;

          if (atChargeLimit && solarW > 50) {
            // ── Negative price + battery at charge limit + solar generating → curtail
            action = 'SOLAR_CURTAIL';
            const limitDesc = batteryFull
              ? `battery full (${simSocPct.toFixed(0)}%)`
              : `battery at charge limit (${chargeLimitSoC}%)`;
            reason = `Negative price (${price.toFixed(1)}ct) and ${limitDesc}. Solar curtailed to stop grid export.`;
            alert  = 'negative_price_curtail';
            simSocKwh = effectiveCapacity; // pinned at charge limit, not capacity
          } else {
            // ── Negative price + battery has room → IDLE, solar fills battery ───
            action = 'IDLE';
            reason = `Negative price (${price.toFixed(1)}ct) — solar charging battery (${simSocPct.toFixed(0)}%). No grid charging.`;
            alert  = 'negative_price';
            simSocKwh = Math.min(effectiveCapacity, Math.max(minKwh, projectedSocKwh));
          }

        } else if (projectedSocKwh < minKwh && !isStrongSolar) {
          // ── SoC would breach floor AND solar is weak: charge from grid ────────
          // Only charge from grid in winter / weak solar conditions.
          // When solar is strong, the battery will fill naturally — don't interfere.
          const chargeKwh = Math.min(chargeKwPerSlot, effectiveCapacity - projectedSocKwh);
          action = 'CHARGE_FROM_GRID';
          watts  = chargePowerWatts;
          reason = `Projected SoC would drop to ${((projectedSocKwh / batteryCapacityKwh) * 100).toFixed(0)}% ` +
                   `(weak solar day). Charging ${chargeKwh.toFixed(2)} kWh at ${price.toFixed(1)}ct.`;
          simSocKwh = Math.min(effectiveCapacity, projectedSocKwh + chargeKwh);

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
            simSocKwh = Math.min(effectiveCapacity, Math.max(minKwh, projectedSocKwh));
          }

        } else if (solarSurplusKwh > 0 && simSocKwh >= effectiveCapacity - 0.1) {
          // ── Solar surplus, battery at charge limit ────────────────────────────
          action = 'SOLAR_SURPLUS';
          watts  = solarW;
          reason = `${(solarW / 1000).toFixed(1)} kW solar surplus — battery at charge limit (${chargeLimitSoC}%), energy exported or used directly.`;
          simSocKwh = effectiveCapacity;

        } else {
          // ── Normal self-consumption ─────────────────────────────────────────
          simSocKwh = Math.min(effectiveCapacity, Math.max(minKwh, projectedSocKwh));
        }

      } else {
        simSocKwh = Math.min(batteryCapacityKwh, Math.max(0, projectedSocKwh));
      }

      // Hard clamp
      simSocKwh = Math.max(0, Math.min(batteryCapacityKwh, simSocKwh));

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
        // v1.5: per-slot energy flows in kWh (3 decimals)
        simLoadKwh:        Math.round(loadKwh        * 1000) / 1000,
        simSolarKwh:       Math.round(solarKwh       * 1000) / 1000,
        simGridImportKwh:  Math.round(simGridImportKwh * 1000) / 1000,
        simGridExportKwh:  Math.round(simGridExportKwh * 1000) / 1000,
        alert,
      });
    }

    return plan;
  }
}

export default new SmartEcoStrategy();