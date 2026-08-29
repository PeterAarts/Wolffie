// core/strategies/PureSolarStrategy.js
//
// Pure Solar — maximise solar self-consumption without a battery.
// Advises the user when to run shiftable loads based on solar forecast
// and day-ahead prices. Curtails solar export (0%) when prices go negative.
//
// No battery commands are ever issued — decide() always returns IDLE.
// The value of this strategy is purely advisory + curtailment control.
//
// Strategy config (strategy_config table, strategy_id = 'pure-solar'):
//   contractType            -- injected from context (system_settings energy.contract_type)
//   fixedPriceCtKwh         -- injected from context (system_settings energy.fixed_price_ct_kwh)
//   negativePriceThreshold  -- ct/kWh at or below which to curtail (default: 0)
//   minSolarWindowW         -- min average solar W to qualify as a "good window" (default: 300)
//   assignedDevices         -- [{ deviceId, name, preferredWindowIndex }]
//                              Persisted per user assignment; falls back to last used.
//
// Day plan slot actions:
//   SOLAR_USE  — good solar window, recommended to run shiftable loads
//   CURTAIL    — negative price, solar export will be / is stopped
//   IDLE       — normal self-consumption, no specific recommendation
//
// Curtailment:
//   Handled by strategyManager._evaluateCurtailment() — the same state machine
//   used by Smart Eco. Pure Solar opts in via the activeId check in _evaluate().

class PureSolarStrategy {
  get id()   { return 'pure-solar'; }
  get name() { return 'Pure Solar'; }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Build a price lookup keyed by ISO datetime string (YYYY-MM-DDTHH:MM).
   * Handles both { datetime, price } and { hour, price } shapes.
   */
  _buildPriceLookup(prices) {
    const map = {};
    for (const p of prices) {
      if (p.datetime) {
        map[p.datetime.slice(0, 16)] = p.price;
      } else if (p.hour != null) {
        map[String(p.hour).padStart(2, '0')] = p.price;
      }
    }
    return map;
  }

  /**
   * Build a solar lookup keyed by local "HH" hour string.
   * Accepts { datetime, watts } or { hour, watts } shapes.
   */
  _buildSolarLookup(solarForecast) {
    const map = {};
    for (const f of solarForecast) {
      if (f.datetime) {
        const h = new Date(f.datetime).getHours();
        map[String(h).padStart(2, '0')] = f.watts ?? 0;
      } else if (f.hour != null) {
        map[String(f.hour).padStart(2, '0')] = f.watts ?? 0;
      }
    }
    return map;
  }

  /**
   * Find contiguous blocks of SOLAR_USE slots.
   * Returns [{ index, startSlot, endSlot, avgSolarW, avgPriceCtKwh }]
   */
  _findSolarWindows(plan) {
    const windows = [];
    let current   = null;

    for (const slot of plan) {
      if (slot.action === 'SOLAR_USE') {
        if (!current) {
          current = {
            startSlot:  slot.slot,
            endSlot:    slot.slot,
            totalSolar: slot.solarForecastW ?? 0,
            totalPrice: slot.priceCtKwh ?? 0,
            count:      1,
          };
        } else {
          current.endSlot     = slot.slot;
          current.totalSolar += slot.solarForecastW ?? 0;
          current.totalPrice += slot.priceCtKwh ?? 0;
          current.count++;
        }
      } else {
        if (current) { windows.push(current); current = null; }
      }
    }
    if (current) windows.push(current);

    return windows.map((w, i) => ({
      index:         i,
      startSlot:     w.startSlot,
      endSlot:       w.endSlot,
      avgSolarW:     Math.round(w.totalSolar / w.count),
      avgPriceCtKwh: parseFloat((w.totalPrice / w.count).toFixed(2)),
    }));
  }

  // ── decide() ──────────────────────────────────────────────────────────────
  // Pure Solar never issues battery or grid commands.
  // Curtailment is handled by strategyManager._evaluateCurtailment().

  async decide(context, config) {
    const { currentPrice, solarPowerW, contractType = 'dynamic' } = context;
    const { negativePriceThreshold = 0 } = config;

    // Flag negative price periods for curtailment
  if (contractType === 'dynamic' && currentPrice !== null && currentPrice <= negativePriceThreshold && (solarPowerW ?? 0) > 50) {
      return {
        action:        'IDLE',
        reason:        `Negative price (${currentPrice.toFixed(1)}ct) — solar curtailment active or pending.`,
        alertRequired: true,
        alert: {
          type:       'negative_price_solar',
          severity:   'warning',
          message:    `Grid price is ${currentPrice.toFixed(1)}ct/kWh. Solar export will be curtailed to avoid paying to export.`,
          summary:    'Negative grid price — solar export will be paused.',
          suggestion: 'Dismiss this alert to keep solar running at full output.',
          action:     'SOLAR_CURTAIL_PENDING',
        },
      };
    }

    return {
      action: 'IDLE',
      reason: 'Pure Solar — self-consumption mode. See day plan for load recommendations.',
    };
  }

  // ── generateFullDayPlan() ─────────────────────────────────────────────────

  async generateFullDayPlan(context, config) {
    const {
      negativePriceThreshold = 0,
      minSolarWindowW        = 300,
      assignedDevices        = [],
    } = config;

    // Contract settings come from context (system_settings category='energy')
    const contractType    = context.contractType    ?? 'dynamic';
    const fixedPriceCtKwh = context.fixedPriceCtKwh ?? 22;

    const {
      windowStart: windowStartRaw,
      windowHours = 24,
      prices       = [],
      solarForecast = [],
    } = context;

    const windowStart = windowStartRaw ? new Date(windowStartRaw) : new Date();
    const totalSlots  = windowHours * 4;

    const priceBySlot = this._buildPriceLookup(prices);
    const solarByHour = this._buildSolarLookup(solarForecast);

    // ── Slot loop ────────────────────────────────────────────────────────────
    const plan = [];

    for (let i = 0; i < totalSlots; i++) {
      const slotTime = new Date(windowStart.getTime() + i * 15 * 60 * 1000);
      const hour     = slotTime.getHours();
      const minute   = slotTime.getMinutes();
      const datetime = slotTime.toISOString().slice(0, 16);
      const hourKey  = String(hour).padStart(2, '0');

      const solarW   = solarByHour[hourKey] ?? 0;

      // Spot price always fetched from day-ahead regardless of contract type
      // (needed for negative-price curtailment even on fixed contracts).
      const spotPrice = priceBySlot[datetime] ?? priceBySlot[hourKey] ?? null;

      // Display price: dynamic = spot; fixed = configured flat rate
      // (but spot is still used internally for curtailment trigger).
      const displayPrice = contractType === 'dynamic'
        ? spotPrice
        : fixedPriceCtKwh;

      // Curtailment decision always uses spot price
      const curtailPrice = spotPrice;

      let action = 'IDLE';
      let reason = 'Self-consumption';

      if (curtailPrice !== null && curtailPrice <= negativePriceThreshold && solarW > 50) {
        action = 'CURTAIL';
        reason = `Negative price (${curtailPrice.toFixed(1)}ct) — solar export curtailed to avoid payment.`;

      } else if (solarW >= minSolarWindowW) {
        action = 'SOLAR_USE';
        reason = contractType === 'dynamic' && spotPrice !== null
          ? `Good solar window: ${(solarW / 1000).toFixed(1)} kW forecast at ${spotPrice.toFixed(1)}ct/kWh — run shiftable loads now.`
          : `Good solar window: ${(solarW / 1000).toFixed(1)} kW forecast — run shiftable loads now.`;
      }

      plan.push({
        slot:           i,
        datetime,
        hour,
        minute,
        action,
        watts:          0,      // Pure Solar never commands battery power
        reason,
        priceCtKwh:     displayPrice,
        solarForecastW: solarW,
        simSocPct:      null,   // No battery — not applicable
        alert:          null,
      });
    }

    // ── Device assignment annotation ──────────────────────────────────────────
    // Find contiguous SOLAR_USE windows and annotate the opening slot of each
    // window with any device assigned to it. The UI reads deviceRecommendation[]
    // to show "run Wasmachine 10:00–13:00" style cards.
    if (assignedDevices.length) {
      const windows = this._findSolarWindows(plan);

      if (windows.length) {
        // Default target: window with highest average solar output
        const bestWindowIdx = windows.reduce(
          (best, w, i) => w.avgSolarW > windows[best].avgSolarW ? i : best, 0
        );

        for (const device of assignedDevices) {
          const targetIdx = device.preferredWindowIndex ?? bestWindowIdx;
          const window    = windows[Math.min(targetIdx, windows.length - 1)];
          const slot      = plan[window.startSlot];

          if (slot) {
            slot.deviceRecommendation = slot.deviceRecommendation ?? [];
            slot.deviceRecommendation.push({
              deviceId: device.deviceId,
              name:     device.name,
              window: {
                start: plan[window.startSlot]?.datetime,
                end:   plan[window.endSlot]?.datetime,
              },
            });
          }
        }
      }
    }

    return plan;
  }
}

export default new PureSolarStrategy();