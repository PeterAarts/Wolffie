// core/strategies/ManualStrategy.js
//
// Manual — follow user-defined schedules and settings.
// The strategy manager takes no automatic actions; all dispatch
// is initiated directly by the user via the Manual Dispatch panel.
//
// This strategy is always available (no required capabilities)
// and serves as the safe fallback when no other strategy can run.

class ManualStrategy {
  get id()   { return 'manual'; }
  get name() { return 'Manual'; }

  async decide(context, config) {
    return { action: 'IDLE', reason: 'Manual mode — waiting for user instructions.' };
  }

  async generateFullDayPlan(context, config) {
    return Array.from({ length: 24 }, (_, hour) => ({
      hour,
      action:         'IDLE',
      watts:          0,
      reason:         'Manual mode',
      priceCtKwh:     context.prices?.find(p => p.hour === hour)?.price ?? null,
      solarForecastW: context.solarForecast?.find(f => f.hour === hour)?.watts ?? 0,
    }));
  }
}

export default new ManualStrategy();