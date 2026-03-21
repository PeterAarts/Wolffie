// core/strategies/PeakShavingStrategy.js
//
// Peak Shaving — limit grid usage during high demand periods.
// Discharge battery during peak hours to reduce grid import.
//
// Stub — decide() returns IDLE until full logic is implemented.

class PeakShavingStrategy {
  get id()   { return 'peak-shaving'; }
  get name() { return 'Peak Shaving'; }

  async decide(context, config) {
    return { action: 'IDLE', reason: 'Peak Shaving strategy — monitoring peak windows.' };
  }

  async generateFullDayPlan(context, config) {
    return Array.from({ length: 24 }, (_, hour) => ({
      hour,
      action:         'IDLE',
      watts:          0,
      reason:         'Self-consumption',
      priceCtKwh:     context.prices?.find(p => p.hour === hour)?.price ?? null,
      solarForecastW: context.solarForecast?.find(f => f.hour === hour)?.watts ?? 0,
    }));
  }
}

export default new PeakShavingStrategy();