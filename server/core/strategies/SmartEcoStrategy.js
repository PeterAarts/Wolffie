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
// Day plan generation (generateFullDayPlan):
//   Runs hourly. Simulates the battery SoC slot-by-slot (96 × 15-min) starting
//   from the current real SoC. For each slot it applies:
//     1. Solar offsets home load first; surplus charges the battery.
//     2. If projected SoC would breach minSocPct → CHARGE_FROM_GRID.
//     3. If price is in top quartile and battery has headroom → DISCHARGE_TO_GRID.
//     4. If negative price → block grid charging (IDLE).
//     5. If solar surplus and battery is full → SOLAR_SURPLUS.
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

  async decide(context, config) {
    const {
      batteryCapacityKwh       = 11.2,
      minSocPct                = 20,
      chargePowerWatts         = 3000,
      negativePriceThreshold   = 0,
      solarSurplusThresholdKwh = 5,
      dischargeFloorCt         = 5.0,   // never discharge to grid below this price
      // Curtailment alert parameters
      curtailmentSocTrigger      = 80,
      curtailmentPricePercentile = 20,
      curtailmentSocStep         = 5,
      curtailmentLookaheadHours  = 2,
      dischargePercentile        = 80,   // only discharge at this price percentile or above
      dischargeLookaheadHours    = 2,    // only discharge when solar is forecast within this window
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
    // Fires when: SoC is high, more solar is incoming, and prices are cheap.
    // Tells users to run high-load appliances now to make room and use free energy.
    // Does NOT override the dispatch action — alert is purely additive.
    let curtailmentAlert = null;
    if (soc >= curtailmentSocTrigger && prices.length >= 5) {
      // Bottom Nth percentile of today's prices
      const sorted       = [...prices].map(p => p.price).filter(p => p != null).sort((a, b) => a - b);
      const percentileIdx = Math.floor((curtailmentPricePercentile / 100) * sorted.length);
      const priceFloor   = sorted[Math.max(0, percentileIdx - 1)] ?? 0;

      // Solar expected in the next N hours
      const lookaheadSlots   = curtailmentLookaheadHours * 4;
      const windowStart      = context.windowStart ? new Date(context.windowStart) : new Date();
      const nowMs            = Date.now();
      const incomingSolarW   = solarForecast
        .filter(f => {
          const fTime = f.datetime ? new Date(f.datetime).getTime() : null;
          return fTime && fTime >= nowMs && fTime < nowMs + lookaheadSlots * 15 * 60 * 1000;
        })
        .reduce((sum, f) => sum + (f.watts ?? 0), 0) / Math.max(1, lookaheadSlots); // avg W

      const solarExpected = incomingSolarW > 200; // >200W average expected in lookahead window

      if (currentPrice <= priceFloor && solarExpected) {
        // SoC bracket: round down to nearest curtailmentSocStep — each bracket fires once
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

    // How many kWh are needed from NOW until solar starts producing?
    // Sum the hourly load profile, wrapping midnight correctly.
    const hoursUntilSolar = hour < profile.solarStartHour
      ? profile.solarStartHour - hour
      : (24 - hour) + profile.solarStartHour;

    const energyNeededKwh = Array.from({ length: hoursUntilSolar }, (_, i) =>
      profile.hourlyLoadProfile[(hour + i) % 24]
    ).reduce((sum, w) => sum + w / 1000, 0);

    // Gap = energy needed until solar minus what battery currently holds above floor.
    const gapKwh = Math.max(0, energyNeededKwh - usableKwh);

    // Negative price detection: look 4 hours ahead
    const negativePricesAhead = this._hasNegativePricesAhead(
      prices, hour, 4, negativePriceThreshold
    );

    // ── Scenario 1: Negative prices coming + strong solar + battery has room ──
    if (
      negativePricesAhead &&
      adjustedSolarKwh >= solarSurplusThresholdKwh &&
      soc > 60
    ) {
      return {
        action:        'IDLE',
        reason:        `Negative prices expected in next 4h, strong solar forecast (${adjustedSolarKwh.toFixed(1)} kWh adjusted). Blocking grid charge — letting solar fill battery.`,
        alertRequired: true,
        alert: {
          type:       'negative_price_solar_surplus',
          severity:   'warning',
          message:    `Negative day-ahead prices expected. Solar forecast ${adjustedSolarKwh.toFixed(1)} kWh. Battery at ${soc}%.`,
          suggestion: `Consider discharging battery to ${minSocPct + 10}% to make room for free solar. Grid charging is blocked.`,
          action:     'DISCHARGE_TO_HOME',
        },
      };
    }

    // ── Scenario 2: Negative prices + full battery + weak solar ──────────────
    if (negativePricesAhead && soc > 80) {
      return {
        action:        'IDLE',
        reason:        `Negative prices ahead, battery ${soc}% — blocking grid charge.`,
        alertRequired: true,
        alert: {
          type:       'negative_price_full_battery',
          severity:   'info',
          message:    `Negative day-ahead prices expected. Battery is ${soc}% — grid charging blocked.`,
          suggestion: `Battery is near full. No action needed unless you want to discharge to home loads.`,
          action:     null,
        },
      };
    }

    // ── Scenario 2.5: Peak price + solar incoming — discharge to make room ────
    // Only fires when ALL conditions are met:
    //   1. Current price ≥ Nth percentile of remaining prices
    //   2. Price ≥ absolute floor (dischargeFloorCt)
    //   3. Solar is forecast within dischargeLookaheadHours
    //   4. Battery has meaningful headroom above minSocPct
    // Amount discharged = only enough to absorb expected solar, not a full dump.
    {
      const dischargeThreshold = this._pricePercentile(prices, hour, dischargePercentile);
      const nowMs              = Date.now();
      const solarInWindowKwh   = this._solarKwhInWindow(solarForecast, nowMs, dischargeLookaheadHours);
      const solarIsComing      = solarInWindowKwh > 0.1; // at least 100Wh expected
      const headroomKwh        = currentKwh - minKwh;
      const isPeakPrice        = dischargeThreshold !== null && currentPrice >= dischargeThreshold;
      const aboveFloor         = currentPrice >= dischargeFloorCt;

      if (isPeakPrice && aboveFloor && solarIsComing && headroomKwh > 0.5) {
        // Only discharge what solar will replace — don't dump more than incoming solar
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
      };
    }

    // ── Scenario 4: Gap exists but solar will more than cover it ─────────────
    if (adjustedSolarKwh > gapKwh * 1.3 && hour < profile.solarStartHour) {
      return {
        action: 'IDLE',
        reason: `Need ${energyNeededKwh.toFixed(1)} kWh over next ${hoursUntilSolar}h but solar forecast (${adjustedSolarKwh.toFixed(1)} kWh adjusted) will cover the gap. Waiting for solar.`,
      };
    }

    // ── Scenario 5: Gap exists, solar won't cover it, now is cheapest window ──
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
  //   3. If post-draw SoC would breach minSocPct → mark CHARGE_FROM_GRID,
  //      add one slot's worth of charge to the simulated SoC.
  //   4. Negative price → IDLE regardless, no grid charging.
  //   5. Top-quartile price + enough SoC headroom → DISCHARGE_TO_GRID.
  //   6. Solar surplus and battery already full → SOLAR_SURPLUS.
  //   7. All other cases → IDLE (self-consumption).
  //
  // Each slot stores simSocPct so the frontend can optionally render a
  // battery trajectory overlay on the timeline.

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
    } = config;

    const { prices = [], solarForecast = [], soc: currentSoc = 50 } = context;
    const windowHours = context.windowHours ?? 24;
    const windowStart = context.windowStart
      ? new Date(context.windowStart)
      : new Date();

    const profile = this._getProfile(config);

    // Physical constants
    const minKwh         = (minSocPct / 100) * batteryCapacityKwh;
    const slotHours      = 0.25;                                    // 15 min = 0.25 h
    const chargeKwPerSlot = (chargePowerWatts / 1000) * slotHours; // kWh added per charging slot

    // ── Index prices by 15-min datetime key (YYYY-MM-DDTHH:MM) ───────────────
    const priceBySlot = {};
    for (const p of prices) {
      if (p.datetime) priceBySlot[p.datetime.slice(0, 16)] = p.price;
    }

    // ── Index solar forecast by hour key (YYYY-MM-DDTHH) ─────────────────────
    const solarByHour = {};
    for (const f of solarForecast) {
      if (f.datetime) {
        solarByHour[f.datetime.slice(0, 13)] = f.watts ?? 0;
      } else if (f.hour !== undefined) {
        const base = new Date(windowStart);
        base.setHours(f.hour, 0, 0, 0);
        solarByHour[base.toISOString().slice(0, 13)] = f.watts ?? 0;
      }
    }

    // ── Adjusted solar total for negative-price guard (same as decide()) ──────
    const adjustedSolarKwh = profile.solarTotalKwh * profile.forecastAccuracyFactor;

    // ── SoC simulation — starts from current real SoC ─────────────────────────
    let simSocKwh = ((currentSoc ?? 50) / 100) * batteryCapacityKwh;

    // ── Pre-compute per-slot solar lookahead budget ───────────────────────────
    // For each slot index, calculate how much solar kWh is expected in the next
    // dischargeLookaheadHours. This determines the max we're allowed to discharge.
    // Keyed by slot index for O(1) lookup inside the loop.
    const solarLookaheadKwh = {};
    const lookaheadSlotCount = dischargeLookaheadHours * 4;
    const totalSlots = windowHours * 4;

    for (let i = 0; i < totalSlots; i++) {
      let solarAhead = 0;
      for (let j = i; j < Math.min(i + lookaheadSlotCount, totalSlots); j++) {
        const t   = new Date(windowStart.getTime() + j * 15 * 60 * 1000);
        const key = t.toISOString().slice(0, 13);
        solarAhead += (solarByHour[key] ?? 0) * slotHours / 1000; // W → kWh per slot
      }
      solarLookaheadKwh[i] = solarAhead;
    }

    const plan = [];

    for (let i = 0; i < totalSlots; i++) {
      const slotTime = new Date(windowStart.getTime() + i * 15 * 60 * 1000);
      const hour     = slotTime.getHours();
      const minute   = slotTime.getMinutes();
      const datetime = slotTime.toISOString().slice(0, 16);
      const hourKey  = slotTime.toISOString().slice(0, 13);

      const price  = priceBySlot[datetime] ?? null;
      const solarW = solarByHour[hourKey]  ?? 0;

      // ── Per-slot energy flows (kWh) ─────────────────────────────────────────
      // Load this slot draws (from nightly profile, pro-rated to 15 min)
      const loadKwh = (profile.hourlyLoadProfile[hour] ?? 300) * slotHours / 1000;

      // Solar available this slot (W → kWh over 15 min)
      const solarKwh = (solarW * slotHours) / 1000;

      // Solar covers home load first; remainder hits battery
      const netLoadKwh      = Math.max(0, loadKwh - solarKwh);   // battery must cover this
      const solarSurplusKwh = Math.max(0, solarKwh - loadKwh);   // surplus charges battery

      // Battery SoC after applying load and solar, before any grid charge/discharge
      const batteryRoomKwh  = batteryCapacityKwh - simSocKwh;
      const solarChargeKwh  = Math.min(solarSurplusKwh, batteryRoomKwh); // can't exceed capacity
      const projectedSocKwh = simSocKwh - netLoadKwh + solarChargeKwh;

      let action = 'IDLE';
      let watts  = 0;
      let reason = 'Self-consumption';
      let alert  = null;

      if (price !== null) {
        const isNegative = price <= negativePriceThreshold;

        // 80th percentile of remaining prices from this slot onwards
        const remainingPrices = Object.entries(priceBySlot)
          .filter(([dt]) => dt >= datetime)
          .map(([, p]) => p)
          .filter(p => p != null)
          .sort((a, b) => a - b);
        const pctIdx       = Math.floor((dischargePercentile / 100) * remainingPrices.length);
        const dischargeThreshold = remainingPrices.length
          ? remainingPrices[Math.min(pctIdx, remainingPrices.length - 1)]
          : null;

        const isPeak          = dischargeThreshold !== null && price >= dischargeThreshold;
        const aboveFloor      = price >= dischargeFloorCt;
        const solarAhead      = solarLookaheadKwh[i] ?? 0;
        const solarIsComing   = solarAhead > 0.1;
        const headroomKwh     = simSocKwh - minKwh;

        if (isNegative) {
          // ── Negative price: block all grid charging ─────────────────────────
          action = 'IDLE';
          reason = `Negative price (${price.toFixed(1)}ct) — grid charging blocked.`;
          alert  = adjustedSolarKwh >= solarSurplusThresholdKwh
            ? 'negative_price_solar'
            : 'negative_price';
          simSocKwh = Math.min(batteryCapacityKwh, Math.max(minKwh, projectedSocKwh));

        } else if (projectedSocKwh < minKwh) {
          // ── SoC would breach floor: charge from grid ────────────────────────
          const deficit   = minKwh - projectedSocKwh;
          const chargeKwh = Math.min(chargeKwPerSlot, batteryCapacityKwh - projectedSocKwh);
          action = 'CHARGE_FROM_GRID';
          watts  = chargePowerWatts;
          reason = `Projected SoC would drop to ${((projectedSocKwh / batteryCapacityKwh) * 100).toFixed(0)}% ` +
                   `(${deficit.toFixed(2)} kWh below floor). ` +
                   `Charging ${chargeKwh.toFixed(2)} kWh at ${price.toFixed(1)}ct.`;
          simSocKwh = Math.min(batteryCapacityKwh, projectedSocKwh + chargeKwh);

        } else if (isPeak && aboveFloor && solarIsComing && headroomKwh > 0.5) {
          // ── Peak price + solar incoming: discharge only to make room ─────────
          // Cap discharge at: expected solar kWh in lookahead window (not per-slot)
          // Spread evenly: discharge budget ÷ number of remaining peak slots.
          // Per-slot cap = chargeKwPerSlot so we don't dump faster than inverter can handle.
          const dischargeKwh = Math.min(
            chargeKwPerSlot,          // max per slot (inverter limit)
            Math.min(solarAhead, headroomKwh)  // can't discharge more than solar incoming OR headroom
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
          // ── Solar surplus, battery already full ─────────────────────────────
          action = 'SOLAR_SURPLUS';
          watts  = solarW;
          reason = `${(solarW / 1000).toFixed(1)} kW solar surplus — battery full, energy exported or used directly.`;
          simSocKwh = batteryCapacityKwh;

        } else {
          // ── Normal self-consumption ─────────────────────────────────────────
          simSocKwh = Math.min(batteryCapacityKwh, Math.max(minKwh, projectedSocKwh));
        }

      } else {
        // ── No price data: still advance SoC simulation ─────────────────────
        simSocKwh = Math.min(batteryCapacityKwh, Math.max(0, projectedSocKwh));
      }

      // Hard clamp — never let floating-point drift take SoC out of bounds
      simSocKwh = Math.max(0, Math.min(batteryCapacityKwh, simSocKwh));

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
        alert,
      });
    }

    return plan;
  }
}

export default new SmartEcoStrategy();