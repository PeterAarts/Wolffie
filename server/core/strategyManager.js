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
//
// Day plan regeneration (hourly, on the hour):
//   - Fired once immediately at startup (via server.js → regenerateDayPlan())
//   - Then scheduled to fire at the top of every hour using a setTimeout
//     aligned to the clock, followed by a fixed hourly setInterval.
//   - Each regeneration builds a fresh 24h rolling window from current SoC,
//     live prices, and solar forecast — so the plan always reflects reality.
//   - On strategy change: triggered immediately via setActiveStrategy().
//   - Guard: if prices are unavailable and a plan already exists, the existing
//     plan is preserved rather than overwritten with an empty/degraded one.

import db           from './database.js';
import registry     from './capabilityRegistry.js';
import settings     from './system/services/settingsService.js';
import alertService from './system/services/alertService.js';

// Built-in strategies — all live in core/strategies/
import smartEcoStrategy       from './strategies/SmartEcoStrategy.js';
import selfSufficientStrategy from './strategies/SelfSufficientStrategy.js';
import peakShavingStrategy    from './strategies/PeakShavingStrategy.js';
import manualStrategy         from './strategies/ManualStrategy.js';

// ─── Strategy Registry ─────────────────────────────────────────────────────
// All known strategies. The UI lists these; only available ones are selectable.

const STRATEGIES = {
  'smart-eco':       smartEcoStrategy,
  'self-sufficient': selfSufficientStrategy,
  'peak-shaving':    peakShavingStrategy,
  'manual':          manualStrategy,
};

// ─── Strategy Metadata ─────────────────────────────────────────────────────
// Declarative definition of each strategy — what it needs to run.
// Used by GET /api/strategies to tell the frontend what's available.

export const STRATEGY_META = {
  'smart-eco': {
    id:                   'smart-eco',
    name:                 'Smart Eco',
    description:          'Optimise for lowest cost using price forecasts.',
    requiredCapabilities: ['grid:pricing'],
    optionalCapabilities: ['battery:charge-from-grid', 'battery:discharge-to-grid', 'solar:forecast'],
  },
  'self-sufficient': {
    id:                   'self-sufficient',
    name:                 'Self-Sufficient',
    description:          'Prioritise solar usage and battery for home loads.',
    requiredCapabilities: ['solar:read', 'battery:read'],
    optionalCapabilities: ['battery:charge-from-grid'],
  },
  'peak-shaving': {
    id:                   'peak-shaving',
    name:                 'Peak Shaving',
    description:          'Limit grid usage during high demand periods.',
    requiredCapabilities: ['battery:read', 'grid:read'],
    optionalCapabilities: ['battery:discharge-to-grid', 'grid:pricing'],
  },
  'manual': {
    id:                   'manual',
    name:                 'Manual',
    description:          'Follow user-defined schedules and settings.',
    requiredCapabilities: [],
    optionalCapabilities: ['battery:charge-from-grid', 'battery:discharge-to-grid'],
  },
};

// ─── Manager ───────────────────────────────────────────────────────────────

class StrategyManager {
  constructor() {
    this._timer            = null;   // evaluation interval
    this._dayPlanTimer     = null;   // one-shot timeout to align to next hour
    this._dayPlanInterval  = null;   // hourly interval after first alignment
    this._running          = false;
    this._lastDecision     = null;
    // Solar curtailment state machine
    // States: 'NORMAL' | 'PENDING' | 'CURTAILED'
    this._curtailState     = 'NORMAL';
    this._curtailPendingSince = null; // Date when PENDING started
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start() {
    if (this._running) return;
    this._running = true;

    const intervalSec = await settings.get('strategy', 'evaluation_interval') ?? 300;
    console.log(`   • StrategyManager Starting — evaluating every ${intervalSec}s`);

    // ── Curtailment watchdog ────────────────────────────────────────────────
    // If the server was previously shut down while solar was curtailed,
    // restore export to 100% immediately before doing anything else.
    await this._curtailmentWatchdog();

    // Evaluate immediately on startup, then on interval
    await this._evaluate();
    this._timer = setInterval(() => this._evaluate(), intervalSec * 1000);
    if (this._timer.unref) this._timer.unref();

    // ── Hourly day plan regeneration ────────────────────────────────────────
    // Align the first fire to the top of the next hour, then run every 60 min.
    // Example: start at 14:47 → first fire at 15:00, then 16:00, 17:00 …
    const now            = new Date();
    const msUntilNextHour =
      (60 - now.getMinutes()) * 60 * 1000
      - now.getSeconds() * 1000
      - now.getMilliseconds();

    console.log(`   • StrategyManager Day plan will regenerate in ${Math.round(msUntilNextHour / 60000)} min, then every hour`);

    this._dayPlanTimer = setTimeout(async () => {
      await this.regenerateDayPlan();

      // Switch to a fixed hourly interval after the first aligned fire
      this._dayPlanInterval = setInterval(
        () => this.regenerateDayPlan(),
        60 * 60 * 1000
      );
      if (this._dayPlanInterval.unref) this._dayPlanInterval.unref();
    }, msUntilNextHour);

    if (this._dayPlanTimer.unref) this._dayPlanTimer.unref();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this._dayPlanTimer) {
      clearTimeout(this._dayPlanTimer);
      this._dayPlanTimer = null;
    }
    if (this._dayPlanInterval) {
      clearInterval(this._dayPlanInterval);
      this._dayPlanInterval = null;
    }
    this._running = false;
    console.log('   • StrategyManager Stopped');
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

    console.log(`   • StrategyManager Active strategy → '${strategyId}'`);

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
      strategy:    { ...meta, active: true, available: true, config },
      decision,
      dayPlan:     dayPlan.plan ?? [],
      windowStart: dayPlan.windowStart,
      windowHours: dayPlan.windowHours,
      generatedAt: dayPlan.generatedAt,
    };
  }

  /**
   * Today's day plan from DB. Returns empty plan if not yet generated.
   */
  async getDayPlan() {
    const activeId = await this._getActiveId();

    // Return the most recently generated plan for this strategy.
    // Rolling window — not bound to a single calendar date.
    const [rows] = await db.pool.query(
      `SELECT plan, generated_at, window_start, window_hours
         FROM strategy_day_plan
        WHERE strategy_id = ?
        ORDER BY generated_at DESC
        LIMIT 1`,
      [activeId]
    );

    if (!rows.length) return { plan: [], windowStart: null, windowHours: 24 };

    return {
      plan:        rows[0].plan,          // MySQL JSON — already parsed by driver
      windowStart: rows[0].window_start,
      windowHours: rows[0].window_hours ?? 24,
      generatedAt: rows[0].generated_at,
    };
  }

  /**
   * Recent strategy decisions for the History log view.
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
   * Regenerate the full 24h rolling day plan for the active strategy.
   *
   * Called:
   *   - Once at server startup (from server.js after start())
   *   - Hourly on the hour (internal _dayPlanTimer / _dayPlanInterval)
   *   - Immediately on strategy change (setActiveStrategy)
   *
   * The plan is always built from the current SoC, live prices, and solar
   * forecast — so each regeneration reflects actual system state, not stale
   * midnight assumptions.
   *
   * Guard: if price data is unavailable and an existing plan is in the DB,
   * the existing plan is preserved to avoid replacing good data with a
   * degraded price-less plan.
   */
  async regenerateDayPlan() {
    const planDate = new Date().toISOString().slice(0, 10);
    const activeId = await this._getActiveId();
    const strategy = STRATEGIES[activeId];

    if (!strategy?.generateFullDayPlan) {
      console.warn(`   • StrategyManager Strategy '${activeId}' has no generateFullDayPlan() — skipping`);
      return;
    }

    const context = await this._buildContext();

    // Guard: preserve existing plan if price data is missing
    if (!context.prices?.length) {
      const [existing] = await db.pool.query(
        'SELECT id FROM strategy_day_plan WHERE plan_date = ? AND strategy_id = ? LIMIT 1',
        [planDate, activeId]
      );
      if (existing.length > 0) {
        console.warn(`   • StrategyManager Skipping day plan regen — no price data, keeping existing plan`);
        return;
      }
    }

    const config      = await this._getConfig(activeId);
    const plan        = await strategy.generateFullDayPlan(context, config);
    const windowStart = context.windowStart ?? new Date().toISOString();
    const windowHours = context.windowHours ?? 24;

    // MySQL DATETIME requires 'YYYY-MM-DD HH:MM:SS' — strip T and Z from ISO
    const windowStartSQL = windowStart.slice(0, 19).replace('T', ' ');

    await db.pool.query(
      `INSERT INTO strategy_day_plan
         (plan_date, strategy_id, plan, window_start, window_hours, generated_at)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         plan         = VALUES(plan),
         window_start = VALUES(window_start),
         window_hours = VALUES(window_hours),
         generated_at = NOW()`,
      [planDate, activeId, JSON.stringify(plan), windowStartSQL, windowHours]
    );

    console.log(
      `   • StrategyManager Day plan regenerated: ${plan.length} slots, ` +
      `${windowHours}h window from ${windowStart.slice(0, 16)} ` +
      `(SoC: ${context.soc ?? '?'}%)`
    );
  }

  // ── Core Evaluation ───────────────────────────────────────────────────────

  async _evaluate() {
    try {
      const activeId    = await this._getActiveId();
      const strategy    = STRATEGIES[activeId];
      const autoExecute = await settings.get('strategy', 'auto_execute') ?? true;

      if (!strategy) {
        console.warn(`   • StrategyManager No strategy implementation for '${activeId}'`);
        return;
      }

      const context  = await this._buildContext();
      const config   = await this._getConfig(activeId);
      const decision = await strategy.decide(context, config);

      // Guard: if the decision is IDLE purely because required data is unavailable
      // (battery:read, grid:pricing not ready), preserve the previous decision and
      // do not overwrite the DB — stale data is better than a misleading IDLE.
      const isDataUnavailable =
        decision.action === 'IDLE' && decision.reason?.includes('not ready');

      if (isDataUnavailable) {
        console.warn(`   • StrategyManager Skipping evaluation — context incomplete: ${decision.reason}`);
        return;
      }

      this._lastDecision = { ...decision, evaluatedAt: new Date().toISOString() };

      // Persist decision
      const [ins] = await db.pool.query(
        `INSERT INTO strategy_decisions
           (strategy_id, action, reason, executed, context)
         VALUES (?, ?, ?, 0, ?)`,
        [activeId, decision.action, decision.reason, JSON.stringify(context)]
      );
      const decisionId = ins.insertId;

      // Write alert if strategy flagged one
      if (decision.alertRequired && decision.alert) {
        await this._writeAlert(activeId, decision.alert);
      }

      // Evaluate solar curtailment state machine (independent of battery dispatch)
      if (activeId === 'smart-eco') {
        const config = await this._getConfig(activeId);
        await this._evaluateCurtailment(context, config);
      }

      // Execute if actionable and auto_execute is on
      if (autoExecute && decision.action !== 'IDLE') {
        await this._execute(decision, decisionId);
      }

    } catch (e) {
      console.error('   • StrategyManager Evaluation error:', e.message);
    }
  }

  async _execute(decision, decisionId) {
    const capabilityMap = {
      'CHARGE_FROM_GRID':  'battery:charge-from-grid',
      'DISCHARGE_TO_GRID': 'battery:discharge-to-grid',
      'STOP':              'battery:stop',
    };

    const capType = capabilityMap[decision.action];
    if (!capType) return; // Unknown action — nothing to execute

    const handler = registry.get(capType);
    if (!handler) {
      console.warn(`   • StrategyManager Action '${decision.action}' requires '${capType}' — not available`);
      return;
    }

    try {
      const result = await handler({
        watts:         decision.power         ?? 2000,
        targetSOC:     decision.targetSoc     ?? 100,
        minimumSOC:    decision.minimumSoc    ?? 20,
        durationHours: decision.durationHours ?? 1,
      });

      await db.pool.query(
        'UPDATE strategy_decisions SET executed = 1, result = ? WHERE id = ?',
        [JSON.stringify(result), decisionId]
      );

      console.log(`   • StrategyManager Executed '${decision.action}' via '${capType}'`);
    } catch (e) {
      console.error(`   • StrategyManager Execution failed for '${decision.action}':`, e.message);
      await db.pool.query(
        'UPDATE strategy_decisions SET executed = 0, result = ? WHERE id = ?',
        [JSON.stringify({ error: e.message }), decisionId]
      );
    }
  }

  // ── Solar Curtailment State Machine ──────────────────────────────────────
  //
  // States:
  //   NORMAL    → condition not met, solar running at 100%
  //   PENDING   → condition met, alert written, 15-min countdown to auto-act
  //   CURTAILED → solar export set to 0%, waiting for condition to clear
  //
  // Transitions:
  //   NORMAL    → PENDING   : soc ≥ actionTrigger AND price ≤ threshold AND solar producing
  //   PENDING   → CURTAILED : 15 min elapsed without dismissal AND condition still holds
  //   PENDING   → NORMAL    : condition clears before 15 min
  //   CURTAILED → NORMAL    : price recovers OR soc drops below (actionTrigger - 10)

  /**
   * Startup watchdog. If server restarted while curtailed, restore solar immediately.
   */
  async _curtailmentWatchdog() {
    try {
      const savedState = await settings.get('strategy', 'curtailment_state');
      if (savedState === 'CURTAILED') {
        console.warn('   • StrategyManager Watchdog: server restarted while solar was curtailed — restoring to 100%');
        await this._curtailSolar(false);
        await settings.set('strategy', 'curtailment_state', 'NORMAL', 'system', 'Watchdog restore on startup');
      }
      this._curtailState = 'NORMAL';
      this._curtailPendingSince = null;
    } catch (e) {
      console.error('   • StrategyManager Curtailment watchdog error:', e.message);
    }
  }

  /**
   * Persist curtailment state to DB so it survives restarts.
   */
  async _saveCurtailState(state) {
    this._curtailState = state;
    try {
      await settings.set('strategy', 'curtailment_state', state, 'system', 'Solar curtailment state');
    } catch (e) {
      console.error('   • StrategyManager Could not persist curtailment state:', e.message);
    }
  }

  /**
   * Call solar:curtail capability.
   * enabled=true → restore 100%, enabled=false → set 0% (stop export).
   */
  async _curtailSolar(curtail) {
    const handler = registry.get('solar:curtail');
    if (!handler) {
      console.warn('   • StrategyManager solar:curtail capability not available');
      return false;
    }
    try {
      const result = await handler({ enabled: !curtail, pct: curtail ? 0 : 100 });
      console.log(`   • StrategyManager Solar curtailment ${curtail ? 'ACTIVE (0%)' : 'RESTORED (100%)'}`);
      return result?.success ?? true;
    } catch (e) {
      console.error('   • StrategyManager solar:curtail failed:', e.message);
      return false;
    }
  }

  /**
   * Evaluate curtailment state machine on each strategy evaluation cycle.
   * Called only when smart-eco is the active strategy.
   */
  async _evaluateCurtailment(context, config) {
    try {
      const {
        negativePriceThreshold     = 0,
        curtailmentActionSocTrigger = 95,
        curtailmentLookaheadHours  = 2,
      } = config;

      const PENDING_MINUTES = 15;
      const RESTORE_SOC_MARGIN = 10; // restore if SoC drops this many % below trigger

      const soc        = context.soc ?? 0;
      const price      = context.currentPrice ?? 999;
      const solarPower = context.solarPowerW ?? 0;

      // Condition: SoC high + price negative/zero + solar currently producing
      const conditionMet =
        soc >= curtailmentActionSocTrigger &&
        price <= negativePriceThreshold    &&
        solarPower > 50;

      // Restore condition: either trigger clears
      const shouldRestore =
        price > negativePriceThreshold ||
        soc < curtailmentActionSocTrigger - RESTORE_SOC_MARGIN;

      // ── State transitions ─────────────────────────────────────────────────

      if (this._curtailState === 'NORMAL') {
        if (conditionMet) {
          // Write pending alert — user has 15 min to dismiss
          await alertService.write('strategy', 'smart-eco', {
            type:       'solar_curtailment_pending',
            severity:   'warning',
            message:    `Battery at ${soc.toFixed(0)}% and prices negative (${price.toFixed(1)}ct). Solar export will be stopped in ${PENDING_MINUTES} minutes unless dismissed.`,
            suggestion: `Dismiss this alert to keep solar running. If not dismissed, Wolffie will set the SolarEdge export limit to 0% automatically.`,
            action:     'SOLAR_CURTAIL_PENDING',
          }, 20); // 20-min dedup so it doesn't spam on every cycle

          this._curtailPendingSince = Date.now();
          await this._saveCurtailState('PENDING');
          console.log(`   • StrategyManager Curtailment PENDING — auto-act in ${PENDING_MINUTES} min`);
        }

      } else if (this._curtailState === 'PENDING') {
        if (shouldRestore) {
          // Condition cleared before 15 min — cancel
          this._curtailPendingSince = null;
          await this._saveCurtailState('NORMAL');
          console.log('   • StrategyManager Curtailment PENDING cancelled — condition cleared');

        } else if (conditionMet) {
          // Check if the pending alert was dismissed (user opted out)
          const pendingAlerts = await alertService.getActive(0); // system user = 0
          const alertDismissed = !pendingAlerts.some(a => a.type === 'solar_curtailment_pending');

          const elapsedMin = (Date.now() - (this._curtailPendingSince ?? Date.now())) / 60000;

          if (alertDismissed) {
            // User dismissed — cancel auto-act, reset to NORMAL
            this._curtailPendingSince = null;
            await this._saveCurtailState('NORMAL');
            console.log('   • StrategyManager Curtailment PENDING — user dismissed, cancelling');

          } else if (elapsedMin >= PENDING_MINUTES) {
            // 15 min elapsed, condition still holds, alert not dismissed → curtail
            const ok = await this._curtailSolar(true);
            if (ok) {
              await alertService.write('strategy', 'smart-eco', {
                type:       'solar_curtailed',
                severity:   'info',
                message:    `Solar export has been stopped (SoC ${soc.toFixed(0)}%, price ${price.toFixed(1)}ct). Will restore automatically when conditions improve.`,
                suggestion: 'Solar will resume automatically when price recovers or battery discharges.',
                action:     'SOLAR_CURTAILED',
              }, 60);
              await alertService.resolveByTypePrefix('strategy', 'solar_curtailment_pending');
              await this._saveCurtailState('CURTAILED');
            }
          } else {
            console.log(`   • StrategyManager Curtailment PENDING — ${Math.round(elapsedMin)}/${PENDING_MINUTES} min elapsed`);
          }
        }

      } else if (this._curtailState === 'CURTAILED') {
        if (shouldRestore) {
          // Condition cleared — restore solar
          await this._curtailSolar(false);
          await alertService.resolveByTypePrefix('strategy', 'solar_curtailed');
          await alertService.resolveByTypePrefix('strategy', 'solar_curtailment_pending');
          this._curtailPendingSince = null;
          await this._saveCurtailState('NORMAL');
          console.log(`   • StrategyManager Curtailment RESTORED — condition cleared (price=${price.toFixed(1)}ct, SoC=${soc.toFixed(0)}%)`);
        } else {
          console.log(`   • StrategyManager Solar remains curtailed (SoC=${soc.toFixed(0)}%, price=${price.toFixed(1)}ct)`);
        }
      }

    } catch (e) {
      console.error('   • StrategyManager _evaluateCurtailment error:', e.message);
    }
  }

  // ── Alert Management ──────────────────────────────────────────────────────
  // All alert writes and reads are now delegated to alertService (app_alerts).
  // strategy_alerts is no longer written to — existing rows are preserved.

  /**
   * Write a strategy alert via the generic alertService.
   * Deduplicates by type within 1 hour.
   */
  async _writeAlert(strategyId, alert) {
    await alertService.write('strategy', strategyId, alert, 60);
  }

  /**
   * Return unresolved alerts not dismissed by userId, filtered to strategy source.
   * Used by GET /api/strategies/alerts.
   */
  async getActiveAlerts(userId) {
    const all = await alertService.getActive(userId);
    return all.filter(a => a.source === 'strategy');
  }

  /**
   * Globally resolve an alert (admin action).
   */
  async resolveAlert(alertId) {
    await alertService.resolve(alertId);
  }

  /**
   * Per-user dismiss — alert persists for other users.
   */
  async dismissAlert(alertId, userId) {
    await alertService.dismiss(alertId, userId);
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
    // Read planning horizon from settings (default 24h)
    const planningHours = parseInt(await settings.get('strategy', 'planning_hours') ?? 24);
    const windowStart   = new Date();
    // Round down to current 15-min slot
    windowStart.setMinutes(Math.floor(windowStart.getMinutes() / 15) * 15, 0, 0);

    const context = {
      timestamp:     new Date().toISOString(),
      windowStart:   windowStart.toISOString(),
      windowHours:   planningHours,
      soc:           null,
      batteryPowerW: null,
      solarPowerW:   null,
      gridPowerW:    null,
      currentPrice:  null,   // ct/kWh
      prices:        [],     // rolling window price array
      solarForecast: [],     // rolling window solar forecast
    };

    // Battery state
    const batteryHandler = registry.get('battery:read');
    if (batteryHandler) {
      try {
        const b = await batteryHandler({});
        context.soc           = b.soc;
        context.batteryPowerW = b.power;
      } catch (e) {
        console.warn('   • StrategyManager battery:read failed:', e.message);
      }
    }

    // Solar
    const solarHandler = registry.get('solar:read');
    if (solarHandler) {
      try {
        const s = await solarHandler({});
        context.solarPowerW = s.total_power ?? s.power;
      } catch (e) {
        console.warn('   • StrategyManager solar:read failed:', e.message);
      }
    }

    // Grid
    const gridHandler = registry.get('grid:read');
    if (gridHandler) {
      try {
        const g = await gridHandler({});
        context.gridPowerW = g.total_active_power ?? g.power;
      } catch (e) {
        console.warn('   • StrategyManager grid:read failed:', e.message);
      }
    }

    // Day-ahead prices — rolling window with 15-min resolution
    const pricingHandler = registry.get('grid:pricing');
    if (pricingHandler) {
      try {
        const p = await pricingHandler({ windowStart, windowHours: planningHours });
        context.prices       = p.prices       ?? [];
        context.currentPrice = p.currentPrice ?? null;
      } catch (e) {
        console.warn('   • StrategyManager grid:pricing failed:', e.message);
      }
    }

    // Solar forecast — rolling window across today + tomorrow
    const forecastHandler = registry.get('solar:forecast');
    if (forecastHandler) {
      try {
        const f = await forecastHandler({ windowStart, windowHours: planningHours });
        context.solarForecast = f.hourly ?? [];
      } catch (e) {
        console.warn('   • StrategyManager solar:forecast failed:', e.message);
      }
    }

    return context;
  }
}

export default new StrategyManager();