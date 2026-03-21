// core/strategyManager.js
//
// The brain of Wolffie. Evaluates the active strategy on a schedule,
// executes resulting actions via the capability registry, and persists
// decisions + day plans to the database.
//
// Lifecycle (called from server startup):
//   strategyManager.start()   — begins evaluation loop
//   strategyManager.stop()    — clears timers on shutdown
//
// Evaluation flow (every `evaluation_interval` seconds):
//   1. Read active strategy ID from system_settings
//   2. Build context (SoC, current price, solar forecast, capabilities)
//   3. Call strategy.decide(context)
//   4. Persist decision to strategy_decisions
//   5. If actionable + auto_execute enabled → call capability registry handler
//   6. Persist execution result

import db        from './database.js';
import registry  from './capabilityRegistry.js';
import settings  from './system/services/settingsService.js';

// Built-in strategies — all live in core/strategies/
import smartEcoStrategy       from './strategies/SmartEcoStrategy.js';
import selfSufficientStrategy from './strategies/SelfSufficientStrategy.js';
import peakShavingStrategy    from './strategies/PeakShavingStrategy.js';
import manualStrategy         from './strategies/ManualStrategy.js';

// ─── Strategy Registry ─────────────────────────────────────────────────────
// All known strategies. The UI lists these; only available ones are selectable.

const STRATEGIES = {
  'smart-eco':      smartEcoStrategy,
  'self-sufficient': selfSufficientStrategy,
  'peak-shaving':   peakShavingStrategy,
  'manual':         manualStrategy,
};

// ─── Strategy Metadata ─────────────────────────────────────────────────────
// Declarative definition of each strategy — what it needs to run.
// Used by GET /api/strategies to tell the frontend what's available.

export const STRATEGY_META = {
  'smart-eco': {
    id:                  'smart-eco',
    name:                'Smart Eco',
    description:         'Optimise for lowest cost using price forecasts.',
    requiredCapabilities: ['grid:pricing'],
    optionalCapabilities: ['battery:charge-from-grid', 'battery:discharge-to-grid', 'solar:forecast'],
  },
  'self-sufficient': {
    id:                  'self-sufficient',
    name:                'Self-Sufficient',
    description:         'Prioritise solar usage and battery for home loads.',
    requiredCapabilities: ['solar:read', 'battery:read'],
    optionalCapabilities: ['battery:charge-from-grid'],
  },
  'peak-shaving': {
    id:                  'peak-shaving',
    name:                'Peak Shaving',
    description:         'Limit grid usage during high demand periods.',
    requiredCapabilities: ['battery:read', 'grid:read'],
    optionalCapabilities: ['battery:discharge-to-grid', 'grid:pricing'],
  },
  'manual': {
    id:                  'manual',
    name:                'Manual',
    description:         'Follow user-defined schedules and settings.',
    requiredCapabilities: [],
    optionalCapabilities: ['battery:charge-from-grid', 'battery:discharge-to-grid'],
  },
};

// ─── Manager ───────────────────────────────────────────────────────────────

class StrategyManager {
  constructor() {
    this._timer       = null;
    this._running     = false;
    this._lastDecision = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start() {
    if (this._running) return;
    this._running = true;

    const intervalSec = await settings.get('strategy', 'evaluation_interval') ?? 300;
    console.log(`     - StrategyManager Starting — evaluating every ${intervalSec}s`);

    // Evaluate immediately on startup, then on interval
    await this._evaluate();

    this._timer = setInterval(() => this._evaluate(), intervalSec * 1000);
    if (this._timer.unref) this._timer.unref();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._running = false;
    console.log('     - StrategyManager Stopped');
  }

  // ── Public API (used by routes) ───────────────────────────────────────────

  /**
   * Returns all strategy metadata enriched with availability + active flag.
   */
  async listStrategies() {
    const activeId = await this._getActiveId();

    return Object.values(STRATEGY_META).map(meta => ({
      ...meta,
      active:    meta.id === activeId,
      available: this._isAvailable(meta),
      // Which optional capabilities are actually present
      activeOptional: meta.optionalCapabilities.filter(c => registry.has(c)),
    }));
  }

  /**
   * Switch the active strategy. Triggers immediate re-evaluation + day plan regen.
   */
  async setActiveStrategy(strategyId, changedBy = 'user') {
    if (!STRATEGY_META[strategyId]) {
      throw new Error(`Unknown strategy: '${strategyId}'`);
    }
    if (!this._isAvailable(STRATEGY_META[strategyId])) {
      throw new Error(`Strategy '${strategyId}' is not available — required capabilities missing`);
    }

    await settings.set('strategy', 'active_strategy', strategyId, changedBy, 'Strategy changed by user');

    console.log(`     - StrategyManager Active strategy → '${strategyId}'`);

    // Re-evaluate immediately with new strategy + regenerate day plan
    await this._evaluate();
    await this.regenerateDayPlan();

    return this.getActiveStrategyState();
  }

  /**
   * Returns the active strategy, its latest decision, and today's day plan.
   */
  async getActiveStrategyState() {
    const activeId = await this._getActiveId();
    const meta     = STRATEGY_META[activeId];
    const config   = await this._getConfig(activeId);
    const decision = this._lastDecision;
    const dayPlan  = await this.getDayPlan();

    return {
      strategy: { ...meta, active: true, available: true, config },
      decision,
      dayPlan,
    };
  }

  /**
   * Today's day plan from DB. Returns empty array if not yet generated.
   */
  async getDayPlan(date = null) {
    const planDate   = date ?? new Date().toISOString().slice(0, 10);
    const activeId   = await this._getActiveId();

    const [rows] = await db.pool.query(
      'SELECT plan, generated_at FROM strategy_day_plan WHERE plan_date = ? AND strategy_id = ?',
      [planDate, activeId]
    );

    if (!rows.length) return [];
    return rows[0].plan; // MySQL JSON column — already parsed by mysql2
  }

  /**
   * Recent strategy decisions for the Events/log view.
   */
  async getRecentDecisions(limit = 48) {
    const [rows] = await db.pool.query(
      `SELECT evaluated_at, strategy_id, action, reason, executed, context, result
         FROM strategy_decisions
        ORDER BY evaluated_at DESC
        LIMIT ?`,
      [limit]
    );
    return rows;
  }

  /**
   * Regenerate the day plan for today (and optionally tomorrow).
   * Called: at midnight, on strategy change, when new price/forecast data arrives.
   */
  async regenerateDayPlan(date = null) {
    const planDate  = date ?? new Date().toISOString().slice(0, 10);
    const activeId  = await this._getActiveId();
    const strategy  = STRATEGIES[activeId];

    if (!strategy?.generateFullDayPlan) {
      console.warn(`     - StrategyManager Strategy '${activeId}' has no generateFullDayPlan()`);
      return;
    }

    const context = await this._buildContext();
    const config  = await this._getConfig(activeId);
    const plan    = await strategy.generateFullDayPlan(context, config);

    await db.pool.query(
      `INSERT INTO strategy_day_plan (plan_date, strategy_id, plan, generated_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE plan = VALUES(plan), generated_at = NOW()`,
      [planDate, activeId, JSON.stringify(plan)]
    );

    console.log(`     - StrategyManager Day plan regenerated for ${planDate} (${plan.length} slots)`);
  }

  // ── Core Evaluation ───────────────────────────────────────────────────────

  async _evaluate() {
    try {
      const activeId   = await this._getActiveId();
      const strategy   = STRATEGIES[activeId];
      const autoExecute = await settings.get('strategy', 'auto_execute') ?? true;

      if (!strategy) {
        console.warn(`[StrategyManager] No strategy implementation for '${activeId}'`);
        return;
      }

      const context = await this._buildContext();
      const config  = await this._getConfig(activeId);
      const decision = await strategy.decide(context, config);

      this._lastDecision = { ...decision, evaluatedAt: new Date().toISOString() };

      // Persist decision
      const [ins] = await db.pool.query(
        `INSERT INTO strategy_decisions
           (strategy_id, action, reason, executed, context)
         VALUES (?, ?, ?, 0, ?)`,
        [activeId, decision.action, decision.reason, JSON.stringify(context)]
      );
      const decisionId = ins.insertId;

      // Execute if actionable and auto_execute is on
      if (autoExecute && decision.action !== 'IDLE') {
        await this._execute(decision, decisionId);
      }

    } catch (e) {
      console.error('     - StrategyManager Evaluation error:', e.message);
    }
  }

  async _execute(decision, decisionId) {
    const capabilityMap = {
      'CHARGE_FROM_GRID':   'battery:charge-from-grid',
      'DISCHARGE_TO_GRID':  'battery:discharge-to-grid',
      'STOP':               'battery:stop',
    };

    const capType = capabilityMap[decision.action];
    if (!capType) return; // Unknown action — nothing to execute

    const handler = registry.get(capType);
    if (!handler) {
      console.warn(`     - StrategyManager Action '${decision.action}' requires '${capType}' — not available`);
      return;
    }

    try {
      const result = await handler({
        watts:        decision.power        ?? 2000,
        targetSOC:    decision.targetSoc    ?? 100,
        minimumSOC:   decision.minimumSoc   ?? 20,
        durationHours: decision.durationHours ?? 1,
      });

      await db.pool.query(
        'UPDATE strategy_decisions SET executed = 1, result = ? WHERE id = ?',
        [JSON.stringify(result), decisionId]
      );

      console.log(`     - StrategyManager Executed '${decision.action}' via '${capType}'`);
    } catch (e) {
      console.error(`     - StrategyManager Execution failed for '${decision.action}':`, e.message);
      await db.query(
        'UPDATE strategy_decisions SET executed = 0, result = ? WHERE id = ?',
        [JSON.stringify({ error: e.message }), decisionId]
      );
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  async _getActiveId() {
    return await settings.get('strategy', 'active_strategy') ?? 'manual';
  }

  async _getConfig(strategyId) {
    const [rows] = await db.pool.query(
      'SELECT config FROM strategy_config WHERE strategy_id = ?',
      [strategyId]
    );
    return rows[0]?.config ?? {};
  }

  _isAvailable(meta) {
    return meta.requiredCapabilities.every(c => registry.has(c));
  }

  /**
   * Builds the evaluation context from all available capability data.
   * Each read is attempted independently — missing capabilities return null
   * without breaking the whole context build.
   */
  async _buildContext() {
    const context = {
      timestamp:      new Date().toISOString(),
      soc:            null,
      batteryPowerW:  null,
      solarPowerW:    null,
      gridPowerW:     null,
      currentPrice:   null,  // ct/kWh
      prices:         [],    // full day-ahead price array
      solarForecast:  [],    // hourly solar forecast
    };

    // Battery state
    const batteryHandler = registry.get('battery:read');
    if (batteryHandler) {
      try {
        const b = await batteryHandler({});
        context.soc           = b.soc;
        context.batteryPowerW = b.power;
      } catch (e) {
        console.warn('     - StrategyManager battery:read failed:', e.message);
      }
    }

    // Solar
    const solarHandler = registry.get('solar:read');
    if (solarHandler) {
      try {
        const s = await solarHandler({});
        context.solarPowerW = s.total_power ?? s.power;
      } catch (e) {
        console.warn('     - StrategyManager solar:read failed:', e.message);
      }
    }

    // Grid
    const gridHandler = registry.get('grid:read');
    if (gridHandler) {
      try {
        const g = await gridHandler({});
        context.gridPowerW = g.total_active_power ?? g.power;
      } catch (e) {
        console.warn('     - StrategyManager grid:read failed:', e.message);
      }
    }

    // Day-ahead prices
    const pricingHandler = registry.get('grid:pricing');
    if (pricingHandler) {
      try {
        const p = await pricingHandler({});
        context.prices       = p.prices ?? [];
        context.currentPrice = p.currentPrice ?? null;
      } catch (e) {
        console.warn('     - StrategyManager grid:pricing failed:', e.message);
      }
    }

    // Solar forecast
    const forecastHandler = registry.get('solar:forecast');
    if (forecastHandler) {
      try {
        const f = await forecastHandler({});
        context.solarForecast = f.hourly ?? [];
      } catch (e) {
        console.warn('     - StrategyManager solar:forecast failed:', e.message);
      }
    }

    return context;
  }
}

export default new StrategyManager();