// modules/strategies/SmartEcoStrategy.js
//
// Smart Eco — minimise energy cost using day-ahead prices.
//
// Logic:
//   - Between 00:00 and maxChargeHour: if battery is below the morning
//     buffer target AND current price is below the threshold → charge
//   - During peak hours (highest price band): if battery has capacity
//     AND discharge-to-grid is available → discharge
//   - Otherwise: IDLE (self-consumption handles the rest)
//
// Context provided by strategyManager._buildContext():
//   { soc, batteryPowerW, solarPowerW, gridPowerW,
//     currentPrice, prices[], solarForecast[] }
//
// Config from strategy_config table (strategy_id = 'smart-eco'):
//   { priceThresholdCents, morningBufferKwh, chargePowerWatts,
//     maxChargeHour, batteryCapacityKwh }

class SmartEcoStrategy {
  get id()   { return 'smart-eco'; }
  get name() { return 'Smart Eco'; }

  // ── Decision ───────────────────────────────────────────────────────────────

  /**
   * Called every evaluation_interval seconds by strategyManager.
   * Returns a decision object — strategyManager handles execution.
   *
   * @param {object} context  Live data snapshot from strategyManager
   * @param {object} config   Persisted config from strategy_config table
   * @returns {{ action, reason, power?, targetSoc?, minimumSoc?, durationHours? }}
   */
  async decide(context, config) {
    const {
      priceThresholdCents = 12,
      morningBufferKwh    = 3.0,
      chargePowerWatts    = 3000,
      maxChargeHour       = 5,
      batteryCapacityKwh  = 11.2,
    } = config;

    const { soc, currentPrice, prices } = context;
    const hour = new Date().getHours();

    // ── Guard: can't decide without a price ──────────────────────────────────
    if (currentPrice === null) {
      return { action: 'IDLE', reason: 'No current price available — grid:pricing not ready' };
    }

    // ── Guard: can't decide without SoC ─────────────────────────────────────
    if (soc === null) {
      return { action: 'IDLE', reason: 'No battery SoC available — battery:read not ready' };
    }

    const currentKwh = (soc / 100) * batteryCapacityKwh;

    // ── Off-peak charging window (00:00 – maxChargeHour) ────────────────────
    if (hour >= 0 && hour < maxChargeHour) {
      if (currentKwh < morningBufferKwh) {
        if (currentPrice <= priceThresholdCents) {
          const shortageKwh  = morningBufferKwh - currentKwh;
          const targetSoc    = Math.ceil((morningBufferKwh / batteryCapacityKwh) * 100);
          // Estimate hours needed: shortage / (chargePowerWatts / 1000)
          const durationHours = Math.min(
            maxChargeHour - hour,
            Math.ceil(shortageKwh / (chargePowerWatts / 1000))
          );

          return {
            action:        'CHARGE_FROM_GRID',
            reason:        `Buffer short by ${shortageKwh.toFixed(1)} kWh. Price ${currentPrice}ct ≤ threshold ${priceThresholdCents}ct.`,
            power:         chargePowerWatts,
            targetSoc,
            durationHours,
          };
        } else {
          return {
            action: 'IDLE',
            reason: `Buffer short but price too high (${currentPrice}ct > ${priceThresholdCents}ct). Waiting.`,
          };
        }
      }
    }

    // ── Peak discharge: export when price is in top quartile ────────────────
    if (prices.length >= 4) {
      const sorted    = [...prices].sort((a, b) => b.price - a.price);
      const topQ      = sorted[Math.floor(sorted.length / 4)].price; // top 25%
      const isPeak    = currentPrice >= topQ;
      const hasCharge = soc > 30; // keep 30% floor

      if (isPeak && hasCharge) {
        return {
          action:        'DISCHARGE_TO_GRID',
          reason:        `Peak price ${currentPrice}ct ≥ top-quartile ${topQ.toFixed(1)}ct. Exporting battery.`,
          power:         chargePowerWatts,  // discharge at same power rating
          minimumSoc:    30,
          durationHours: 1,
        };
      }
    }

    return { action: 'IDLE', reason: 'Price and SoC within normal range — self-consumption mode.' };
  }

  // ── Day Plan ───────────────────────────────────────────────────────────────

  /**
   * Generates a 24-slot hourly plan using the price array + solar forecast
   * from context. Called by strategyManager.regenerateDayPlan().
   *
   * Each slot: { hour, action, watts, reason, priceCtKwh, solarForecastW }
   *
   * @param {object} context  From strategyManager._buildContext()
   * @param {object} config   From strategy_config table
   * @returns {object[]}      24 hourly plan slots
   */
  async generateFullDayPlan(context, config) {
    const {
      priceThresholdCents = 12,
      morningBufferKwh    = 3.0,
      chargePowerWatts    = 3000,
      maxChargeHour       = 5,
      batteryCapacityKwh  = 11.2,
    } = config;

    const { prices = [], solarForecast = [] } = context;

    // Index price and forecast by hour for O(1) lookup
    const priceByHour    = Object.fromEntries(prices.map(p => [p.hour, p.price]));
    const forecastByHour = Object.fromEntries(solarForecast.map(f => [f.hour, f.watts]));

    // Top-quartile threshold across the full day
    const topQ = prices.length >= 4
      ? [...prices].sort((a, b) => b.price - a.price)[Math.floor(prices.length / 4)].price
      : null;

    const plan = [];

    for (let hour = 0; hour < 24; hour++) {
      const price       = priceByHour[hour]    ?? null;
      const solarW      = forecastByHour[hour]  ?? 0;
      let   action      = 'IDLE';
      let   watts       = 0;
      let   reason      = 'Self-consumption';

      if (price !== null) {
        // Charging window
        if (hour >= 0 && hour < maxChargeHour && price <= priceThresholdCents) {
          action = 'CHARGE_FROM_GRID';
          watts  = chargePowerWatts;
          reason = `Cheap rate (${price}ct) — morning buffer window`;
        }
        // Peak export window
        else if (topQ !== null && price >= topQ && hour >= maxChargeHour) {
          action = 'DISCHARGE_TO_GRID';
          watts  = chargePowerWatts;
          reason = `Peak price (${price}ct ≥ ${topQ.toFixed(1)}ct) — export`;
        }
        // Solar surplus hours — informational only
        else if (solarW > 1000) {
          action = 'SOLAR_SURPLUS';
          watts  = solarW;
          reason = `${(solarW / 1000).toFixed(1)} kW solar expected — good time for loads`;
        }
      }

      plan.push({
        hour,
        action,
        watts,
        reason,
        priceCtKwh:    price,
        solarForecastW: solarW,
      });
    }

    return plan;
  }
}

export default new SmartEcoStrategy();