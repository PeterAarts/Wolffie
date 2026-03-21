// core/strategies/SelfSufficientStrategy.js
//
// Self-Sufficient — prioritise solar usage and battery for home loads.
// Minimise grid import; only charge from grid as a last resort.
//
// Stub — decide() returns IDLE until full logic is implemented.

class SelfSufficientStrategy {
  get id()   { return 'self-sufficient'; }
  get name() { return 'Self-Sufficient'; }

  async decide(context, config) {
    return { action: 'IDLE', reason: 'Self-Sufficient strategy — self-consumption mode active.' };
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

export default new SelfSufficientStrategy();