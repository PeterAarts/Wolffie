// core/strategyManager.js
//
// Wijzigingen t.o.v. MySQL-versie:
//   NOW()                              →  datetime('now')
//   ON DUPLICATE KEY UPDATE = VALUES() →  ON CONFLICT DO UPDATE SET = excluded.
//   DATE_SUB(NOW(), INTERVAL ? DAY)    →  datetime('now', '-' || ? || ' days')
//   DATE_SUB(CURDATE(), INTERVAL ? DAY)→  date('now', '-' || ? || ' days')
//
// getEffectiveness(): history_daily en solar_forecast_accuracy (met forecast_date/
// accuracy_pct) bestaan niet in het huidige schema. De methode vangt fouten op
// en geeft een leeg resultaat terug zodat het dashboard niet crasht.

import db           from './database.js';
import registry     from './capabilityRegistry.js';
import settings     from './system/services/settingsService.js';
import alertService from './system/services/alertService.js';
import eventLog     from './system/services/eventLogService.js';

import smartEcoStrategy    from './strategies/SmartEcoStrategy.js';
import pureSolarStrategy   from './strategies/PureSolarStrategy.js';
import peakShavingStrategy from './strategies/PeakShavingStrategy.js';
import manualStrategy      from './strategies/ManualStrategy.js';
import { padName } from './utils/logger.js';

const STRATEGIES = {
  'smart-eco':    smartEcoStrategy,
  'pure-solar':   pureSolarStrategy,
  'peak-shaving': peakShavingStrategy,
  'manual':       manualStrategy,
};
const PREFIX = padName('Strategy-Manager');

export const STRATEGY_META = {
  'smart-eco': {
    id:                   'smart-eco',
    name:                 'Smart Eco',
    description:          'Optimise for lowest cost using price forecasts.',
    requiredCapabilities: ['grid:pricing'],
    optionalCapabilities: ['battery:charge-from-grid', 'battery:discharge-to-grid', 'solar:forecast'],
  },
  'pure-solar': {
    id:                   'pure-solar',
    name:                 'Pure Solar',
    description:          'Maximise solar self-consumption. Advisory load windows + negative-price curtailment.',
    requiredCapabilities: ['solar:forecast'],
    optionalCapabilities: ['grid:pricing', 'solar:curtail', 'devices:switch'],
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

class StrategyManager {
  constructor() {
    this._timer               = null;
    this._dayPlanTimer        = null;
    this._dayPlanInterval     = null;
    this._running             = false;
    this._lastDecision        = null;
    this._curtailState        = 'NORMAL';
    this._curtailPendingSince = null;

    // ── Grid availability tracking ──────────────────────────────────────────
    // Last known grid:status reading. null = never read yet / capability not
    // implemented — kept distinct from `false` (genuinely disconnected) so
    // _checkGridAvailability doesn't misfire on startup before the first read.
    this._gridConnected = null;

    // ── Load anomaly tracking (smart-eco only) ──────────────────────────────
    this._loadAnomalySince     = null;   // Date.now() when sustained elevated load first started
    this._loadAnomalyConfirmed = false;  // true once past the 2h sustained threshold
    this._loadAnomalyAlertId   = null;   // pending confirm/decline alert id, while a held action exists
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start() {
    if (this._running) return;
    this._running = true;

    const intervalSec = await settings.get('strategy', 'evaluation_interval') ?? 300;
    console.log(`   • ${PREFIX} - evaluating every ${intervalSec}s`);

    await this._curtailmentWatchdog();
    await this._evaluate();
    this._timer = setInterval(() => this._evaluate(), intervalSec * 1000);
    if (this._timer.unref) this._timer.unref();

    const now             = new Date();
    const msUntilNextHour =
      (60 - now.getMinutes()) * 60 * 1000
      - now.getSeconds() * 1000
      - now.getMilliseconds();

    console.log(`   • ${PREFIX} - Day plan will regenerate in ${Math.round(msUntilNextHour / 60000)} min, then every hour`);

    this._dayPlanTimer = setTimeout(async () => {
      await this.regenerateDayPlan();
      this._dayPlanInterval = setInterval(() => this.regenerateDayPlan(), 60 * 60 * 1000);
      if (this._dayPlanInterval.unref) this._dayPlanInterval.unref();
    }, msUntilNextHour);

    if (this._dayPlanTimer.unref) this._dayPlanTimer.unref();
  }

  stop() {
    if (this._timer)         { clearInterval(this._timer);         this._timer         = null; }
    if (this._dayPlanTimer)  { clearTimeout(this._dayPlanTimer);   this._dayPlanTimer  = null; }
    if (this._dayPlanInterval){ clearInterval(this._dayPlanInterval); this._dayPlanInterval = null; }
    this._running = false;
    console.log(`   • ${PREFIX} - Stopped`);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async listStrategies() {
    const activeId = await this._getActiveId();
    return Object.values(STRATEGY_META).map(meta => ({
      ...meta,
      active:         meta.id === activeId,
      available:      this._isAvailable(meta),
      activeOptional: meta.optionalCapabilities.filter(c => registry.has(c)),
    }));
  }

  async setActiveStrategy(strategyId, changedBy = 'user') {
    if (!STRATEGY_META[strategyId]) throw new Error(`Unknown strategy: '${strategyId}'`);
    if (!this._isAvailable(STRATEGY_META[strategyId]))
      throw new Error(`Strategy '${strategyId}' is not available — required capabilities missing`);

    await settings.upsert('strategy', 'active_strategy', strategyId, {
      changedBy, reason: 'Strategy changed by user', valueType: 'string',
    });

    console.log(`   • StrategyManager Active strategy → '${strategyId}'`);
    await this._evaluate();
    await this.regenerateDayPlan();
    return this.getActiveStrategyState();
  }

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

  async getDayPlan() {
    const activeId = await this._getActiveId();
    const [rows] = await db.pool.query(
      `SELECT plan, generated_at, window_start, window_hours
         FROM strategy_day_plan
        WHERE strategy_id = ?
        ORDER BY generated_at DESC
        LIMIT 1`,
      [activeId]
    );

    if (!rows.length) return { plan: [], windowStart: null, windowHours: 24 };

    // SQLite geeft JSON-kolommen terug als ruwe string — mysql2 parseerde dit automatisch.
    // JSON.parse is idempotent: als het al een object is (toekomstige wijziging) blijft het werken.
    const parsedPlan = typeof rows[0].plan === 'string'
      ? JSON.parse(rows[0].plan)
      : (rows[0].plan ?? []);

    return {
      plan:        parsedPlan,
      windowStart: rows[0].window_start,
      windowHours: rows[0].window_hours ?? 24,
      generatedAt: rows[0].generated_at,
    };
  }

  async getRecentDecisions(limit = 48) {
    const [rows] = await db.pool.query(
      `SELECT evaluated_at, strategy_id, action, reason, executed, context, result
         FROM strategy_decisions
        ORDER BY evaluated_at DESC
        LIMIT ?`,
      [limit]
    );
    // SQLite geeft JSON-kolommen terug als string — parseer naar object
    return rows.map(row => ({
      ...row,
      context: row.context && typeof row.context === 'string' ? JSON.parse(row.context) : row.context,
      result:  row.result  && typeof row.result  === 'string' ? JSON.parse(row.result)  : row.result,
    }));
  }

  // ── Day plan regeneration ─────────────────────────────────────────────────
  //
  // Wijzigingen:
  //   NOW()                              →  datetime('now')
  //   ON DUPLICATE KEY UPDATE = VALUES() →  ON CONFLICT(plan_date, strategy_id)
  //                                         DO UPDATE SET = excluded.

async regenerateDayPlan(date = null, source = 'timer') {
    console.log(`   • ${PREFIX} - Day plan regeneration triggered by: ${source}`);
    const _now    = new Date();
    const planDate = `${_now.getFullYear()}-` +
      `${String(_now.getMonth() + 1).padStart(2, '0')}-` +
      `${String(_now.getDate()).padStart(2, '0')}`;

    const activeId = await this._getActiveId();
    const strategy = STRATEGIES[activeId];

    if (!strategy?.generateFullDayPlan) {
      console.warn(`   • ${PREFIX} - '${activeId}' has no generateFullDayPlan() — skipping`);
      return;
    }

    const context = await this._buildContext();

    if (context.soc === null || context.soc === undefined) {
      console.warn(`   • ${PREFIX} - Skipping day plan regen — battery SoC unavailable`);
      return;
    }

    if (!context.prices?.length) {
      const [existing] = await db.pool.query(
        'SELECT id FROM strategy_day_plan WHERE plan_date = ? AND strategy_id = ? LIMIT 1',
        [planDate, activeId]
      );
      if (existing.length > 0) {
        console.warn(`   • ${PREFIX} - Skipping day plan regen — no price data, keeping existing plan`);
        return;
      }
    }

    const config        = await this._getConfig(activeId);
    const plan          = await strategy.generateFullDayPlan(context, config);
    const windowStart   = context.windowStart ?? new Date().toISOString();
    const windowHours   = context.windowHours ?? 24;
    const windowStartSQL = windowStart.slice(0, 19).replace('T', ' ');

    await db.pool.query(
      `INSERT INTO strategy_day_plan
         (plan_date, strategy_id, plan, window_start, window_hours, generated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(plan_date, strategy_id) DO UPDATE SET
         plan         = excluded.plan,
         window_start = excluded.window_start,
         window_hours = excluded.window_hours,
         generated_at = excluded.generated_at`,
      [planDate, activeId, JSON.stringify(plan), windowStartSQL, windowHours]
    );

    console.log(
      `   • ${PREFIX} - Day plan regenerated: ${plan.length} slots, ` +
      `${windowHours}h window (SoC: ${context.soc ?? '?'}%)`
    );
  }

  // ── Core evaluation ───────────────────────────────────────────────────────

  async _evaluate() {
    try {
      const activeId    = await this._getActiveId();
      const strategy    = STRATEGIES[activeId];
      const autoExecute = await settings.get('strategy', 'auto_execute') ?? true;
      const origin       = `strategy:${activeId}`;

      if (!strategy) {
        console.warn(`   • ${PREFIX} - No strategy implementation for '${activeId}'`);
        return;
      }

      const context = await this._buildContext();
      const config  = await this._getConfig(activeId);

      // ── Grid availability gate — applies to every strategy ─────────────────
      // While grid is down (UPS/island mode), any charge/discharge command
      // would fail outright — held, not attempted, every cycle until grid
      // returns. Logged inside the check itself.
      if (await this._checkGridAvailability(context, origin)) {
        return;
      }

      // ── Manual-override guard ───────────────────────────────────────────────
      // A manual dispatch is authoritative until it expires or is explicitly
      // stopped — the strategy must not re-arm/clobber it on the next tick.
      // Safety gate above still wins over this (grid availability checked first).
      const dispatchStatusHandler = registry.get('battery:status');
      if (dispatchStatusHandler) {
        try {
          const ds = await dispatchStatusHandler({});
          // Non-strategy origin ('manual:api', 'capability', etc.) is treated as
          // authoritative and must not be clobbered — only strategy-vs-strategy
          // re-evaluation should freely re-arm.
          if (ds.active && !ds.origin?.startsWith('strategy:') && ds.status !== 'stopping') {
            console.log(`   • ${PREFIX} - Deferring — active non-strategy dispatch [origin: ${ds.origin}] (${ds.remainingSeconds ?? '?'}s remaining)`);
            return;
          }
        } catch (e) {
          console.warn(`   • ${PREFIX} - battery:status check failed: ${e.message}`);
        }
      }

      // SoC drift guard
      const dayPlan = await this.getDayPlan();
      if (dayPlan.plan?.length > 0 && context.soc !== null) {
        const nowHour = new Date().getHours();
        const nowMin  = new Date().getMinutes();
        const currentSlot = dayPlan.plan.find(
          s => s.hour === nowHour && Math.abs(s.minute - nowMin) < 15
        );
        if (currentSlot) {
          const drift = Math.abs(currentSlot.simSocPct - context.soc);
          if (drift > 5) {
            console.warn(`   • ${PREFIX} - SoC Drift: Plan expects ${currentSlot.simSocPct}%, Reality is ${context.soc}%. Regenerating...`);
            await this.regenerateDayPlan('soc-drift');
            return;
          }
        }
      }

      const decision = await strategy.decide(context, config);

      const isDataUnavailable =
        decision.action === 'IDLE' && decision.reason?.includes('not ready');

      if (isDataUnavailable) {
        console.warn(`   • ${PREFIX} - Skipping evaluation — context incomplete: ${decision.reason}`);
        return;
      }

      this._lastDecision = { ...decision, evaluatedAt: new Date().toISOString() };

      const [ins] = await db.pool.query(
        `INSERT INTO strategy_decisions (strategy_id, action, reason, executed, context)
         VALUES (?, ?, ?, 0, ?)`,
        [activeId, decision.action, decision.reason, JSON.stringify(context)]
      );
      const decisionId = ins.insertId;

      if (decision.alertRequired && decision.alert) {
        await this._writeAlert(activeId, decision.alert);
      }

      if (activeId === 'smart-eco' || activeId === 'pure-solar') {
        await this._evaluateCurtailment(context, config, activeId);
      }

      // ── Load anomaly gate — smart-eco only ────────────────────────────────
      // Scoped to smart-eco because the comparison baseline
      // (nightlyProfile.hourlyLoadProfile) only exists in smart-eco's config.
      // Logged inside the check itself.
      const held = activeId === 'smart-eco'
        ? await this._checkLoadAnomaly(context, config, decision, origin)
        : false;

      if (autoExecute && decision.action !== 'IDLE' && !held) {
        await this._execute(decision, decisionId, activeId);
      } else if (autoExecute && decision.action === 'IDLE') {
        await this._stopIfActive(origin, decisionId);
      } else if (held) {
        console.log(`   • ${PREFIX} - '${decision.action}' held — anomaly confirmation pending`);
      }

    } catch (e) {
      console.error(`   • ${PREFIX} - Evaluation error:`, e.message);
    }
  }

  async _execute(decision, decisionId, activeId) {
    const capabilityMap = {
      'CHARGE_FROM_GRID':  'battery:charge-from-grid',
      'DISCHARGE_TO_GRID': 'battery:discharge-to-grid',
      'STOP':              'battery:stop',
    };

    const capType = capabilityMap[decision.action];
    if (!capType) return;

    const handler = registry.get(capType);
    if (!handler) {
      console.warn(`   • ${PREFIX} - Action '${decision.action}' requires '${capType}' — not available`);
      return;
    }

    const origin = `strategy:${activeId}`;

    try {
      const result = await handler({
        watts:         decision.power         ?? 2000,
        targetSOC:     decision.targetSoc     ?? 100,
        minimumSOC:    decision.minimumSoc    ?? 20,
        durationHours: decision.durationHours ?? 1,
        origin,
      });

      await db.pool.query(
        'UPDATE strategy_decisions SET executed = 1, result = ? WHERE id = ?',
        [JSON.stringify(result), decisionId]
      );

      // Log dispatch event — resolve any prior active dispatch first
      const eventName = decision.action === 'STOP' ? 'dispatch_stopped'
                      : decision.action === 'CHARGE_FROM_GRID' ? 'charge_started'
                      : 'discharge_started';

      await eventLog.resolveByCategory('dispatch');

      if (decision.action !== 'STOP') {
        await eventLog.log(origin, 'dispatch', eventName, 'notice',
          `${decision.action} executed: ${decision.reason?.slice(0, 120) ?? ''}`,
          { watts: decision.power, action: decision.action, decisionId });
      } else {
        await eventLog.log(origin, 'dispatch', eventName, 'info',
          'Dispatch stopped by strategy — returning to self-consumption');
      }

      console.log(`   • ${PREFIX} - Executed '${decision.action}' via '${capType}'`);
    } catch (e) {
      console.error(`   • ${PREFIX} - Execution failed for '${decision.action}':`, e.message);
      await db.pool.query(
        'UPDATE strategy_decisions SET executed = 0, result = ? WHERE id = ?',
        [JSON.stringify({ error: e.message }), decisionId]
      );

      await eventLog.log(origin, 'dispatch', `${decision.action.toLowerCase()}_failed`, 'error',
        `Strategy dispatch failed: ${e.message}`,
        { action: decision.action, decisionId });
    }
  }

  /**
   * Called when the strategy's decision is IDLE. Previously this was a no-op —
   * capabilityMap has no 'IDLE' entry, so a transition into IDLE never told
   * the hardware to stop; an active dispatch just kept re-writing itself every
   * collector cycle until its own internal session timer expired on its own
   * schedule, disconnected from what the strategy currently wanted.
   *
   * Skips if nothing is active, if a stop is already in flight ('stopping'),
   * or if the active dispatch's origin is 'manual' — manual dispatches are
   * only ever stopped explicitly by the user, never implicitly by IDLE.
   */
  async _stopIfActive(origin, decisionId) {
    const dsHandler = registry.get('battery:status');
    if (!dsHandler) return;

    let ds;
    try {
      ds = await dsHandler({});
    } catch (e) {
      console.warn(`   • ${PREFIX} - battery:status check failed: ${e.message}`);
      return;
    }
    // Never auto-stop a non-strategy-initiated dispatch (manual, capability, etc.) —
    // IDLE only clears dispatches the strategy itself is responsible for.
    if (!ds.active || ds.status === 'stopping' || !ds.origin?.startsWith('strategy:')) return;

    const stopHandler = registry.get('battery:stop');
    if (!stopHandler) {
      console.warn(`   • ${PREFIX} - Decision IDLE but 'battery:stop' capability unavailable — cannot stop active dispatch`);
      return;
    }

    try {
      await stopHandler({ origin });
      await eventLog.log(origin, 'dispatch', 'dispatch_stopped', 'notice',
        'Strategy decided IDLE — stopping previously active dispatch.', { decisionId });
      console.log(`   • ${PREFIX} - Decision IDLE — stop issued for active '${ds.status}' dispatch [was origin: ${ds.origin}]`);
    } catch (e) {
      console.error(`   • ${PREFIX} - Stop-on-IDLE failed:`, e.message);
      await eventLog.log(origin, 'dispatch', 'stop_on_idle_failed', 'error',
        `Strategy decided IDLE but stop failed: ${e.message}`, { decisionId });
    }
  }

  // ── Grid Availability & Load Anomaly Gates ────────────────────────────────
  //
  // Both gates sit in front of dispatch, not inside any individual strategy's
  // decide() — UPS/island-mode affects every strategy equally, and the
  // load-anomaly baseline (nightlyProfile) is the one piece smart-eco-specific
  // data this needs, so scoping happens here in _evaluate() rather than by
  // duplicating logic into each strategy file.

  /**
   * Detect UPS/island-mode transitions. While grid is down, any
   * charge/discharge command would fail outright — so dispatch is held,
   * not attempted, every cycle until grid returns. On restore, force an
   * immediate day-plan regen (same pattern as the existing SoC-drift guard) —
   * SoC may have moved a lot during the outage and the stale plan is now
   * actively wrong, not just slightly off.
   *
   * @param {object} context  - from _buildContext(), needs gridConnected
   * @param {string} origin   - e.g. 'strategy:smart-eco', for event logging
   * @returns {Promise<boolean>} true if dispatch should be SKIPPED this cycle
   */
  async _checkGridAvailability(context, origin) {
    const connected = context.gridConnected;

    // Capability not implemented, or genuinely unknown — don't block dispatch
    // on a signal we don't have.
    if (connected === null || connected === undefined) return false;

    const wasConnected = this._gridConnected;
    this._gridConnected = connected;

    if (!connected) {
      if (wasConnected !== false) {
        await eventLog.log(origin, 'grid', 'grid_unavailable_ups_mode', 'warning',
          `Grid unavailable (UPS/island mode${context.gridStatusMode ? `, mode=${context.gridStatusMode}` : ''}). ` +
          `Dispatch held this cycle — charge/discharge would fail with no grid.`);
      }
      return true;
    }

    if (wasConnected === false) {
      await eventLog.log(origin, 'grid', 'grid_restored', 'notice',
        'Grid restored after UPS/island mode. Forcing immediate day-plan regeneration.');
      await this.regenerateDayPlan('grid-restored');
      // Falls through — decide()/execute() continue normally below in this
      // same tick, since grid really is back now. No need to re-call _evaluate().
    }

    return false;
  }

  /**
   * SmartEco-specific: hold CHARGE_FROM_GRID/DISCHARGE_TO_GRID behind an
   * explicit confirm/decline once load has been ≥1.5x the hourly profile
   * average for 2+ hours. No confirmation = no action, indefinitely — this
   * deliberately does NOT mirror the curtailment flow's timeout-to-act
   * pattern; silence here means stay put, not proceed.
   *
   * Both CHARGE_FROM_GRID and DISCHARGE_TO_GRID are gated: once SoC is below
   * floor during a load anomaly, grid gets used regardless of which action
   * the strategy picks, so an uncommitted CHARGE_FROM_GRID deserves the same
   * pause as DISCHARGE_TO_GRID does. STOP/IDLE are never held — STOP is
   * protective and IDLE has nothing to commit.
   *
   * Scoped to smart-eco only: the baseline this compares against
   * (nightlyProfile.hourlyLoadProfile) only exists in smart-eco's config.
   *
   * @param {object} context   - from _buildContext(), needs loadPowerW
   * @param {object} config    - smart-eco strategy config
   * @param {object} decision  - this cycle's decide() result
   * @param {string} origin    - e.g. 'strategy:smart-eco', for logging/alerts
   * @returns {Promise<boolean>} true if the decision should be HELD this cycle
   */
  async _checkLoadAnomaly(context, config, decision, origin) {
    const ANOMALY_MULTIPLIER   = 1.5;
    const SUSTAINED_MS         = 2 * 60 * 60 * 1000; // 2 hours
    const TEMP_LABEL_THRESHOLD = 29; // °C — cosmetic label only, never a gate

    if (context.loadPowerW === null) return false;

    const expectedW = smartEcoStrategy.getExpectedLoadW(config);
    if (expectedW === null) return false;

    const isElevated = context.loadPowerW >= expectedW * ANOMALY_MULTIPLIER;
    const now = Date.now();

    if (!isElevated) {
      if (this._loadAnomalyConfirmed) {
        await eventLog.log(origin, 'strategy', 'load_anomaly_cleared', 'info',
          `Load back to normal (${Math.round(context.loadPowerW)}W vs ${Math.round(expectedW)}W expected). Hold released.`);
        if (this._loadAnomalyAlertId) {
          await alertService.resolveByTypePrefix('strategy', 'load_anomaly_action_hold');
        }
      }
      this._loadAnomalySince     = null;
      this._loadAnomalyConfirmed = false;
      this._loadAnomalyAlertId   = null;
      return false;
    }

    // Elevated — start or continue the clock
    if (!this._loadAnomalySince) this._loadAnomalySince = now;
    if (now - this._loadAnomalySince < SUSTAINED_MS) return false; // elevated, not long enough yet

    // Sustained past 2h — log once on the transition into "confirmed"
    // context.outdoorTempC: not currently wired into _buildContext() — see
    // patch notes. Optional chaining means this just silently stays
    // unlabeled until an actual ambient-temperature source is plumbed in.
    const likelyAc = context.outdoorTempC != null && context.outdoorTempC > TEMP_LABEL_THRESHOLD;

    if (!this._loadAnomalyConfirmed) {
      this._loadAnomalyConfirmed = true;
      await eventLog.log(origin, 'strategy', 'load_anomaly_detected', 'warning',
        `Load sustained at ${Math.round(context.loadPowerW)}W (≥${ANOMALY_MULTIPLIER}x the ${Math.round(expectedW)}W expected) for 2h+.` +
        `${likelyAc ? ` Outdoor temp >${TEMP_LABEL_THRESHOLD}°C — likely AC.` : ''}`);
    }

    // Only CHARGE_FROM_GRID / DISCHARGE_TO_GRID are worth holding — STOP is
    // protective and should never be blocked; IDLE has nothing to hold.
    if (!['CHARGE_FROM_GRID', 'DISCHARGE_TO_GRID'].includes(decision?.action)) return false;

    if (this._loadAnomalyAlertId) {
      const response = await alertService.getResponse(this._loadAnomalyAlertId);
      if (response === 'confirmed') return false; // let it through
      return true; // declined, or still pending — keep holding
    }

    // First cycle with an actual action to hold — raise the alert
 // First cycle with an actual action to hold — raise the alert
    this._loadAnomalyAlertId = await alertService.write('strategy', 'smart-eco', {
      type:       'load_anomaly_action_hold',
      severity:   'warning',
      message:    `Load has been ${Math.round(context.loadPowerW)}W (≥${ANOMALY_MULTIPLIER}x expected) for 2h+` +
                  `${likelyAc ? ' — likely AC' : ''}. SmartEco wants to ${decision.action} (${decision.reason}). ` +
                  `Confirm to continue, or it will not run.`,
      summary:    `High load detected. SmartEco wants to ${decision.action === 'CHARGE_FROM_GRID' ? 'charge from grid' : 'discharge to grid'} — confirm to proceed.`,
      suggestion: 'Confirm to let this proceed, or decline to keep holding.',
      action:     'CONFIRM_OR_DECLINE',
    }, 1440); // long dedup window — this is a held state, not a repeating notice
    await eventLog.log(origin, 'dispatch', 'action_held_pending_confirmation', 'notice',
      `Held '${decision.action}' pending confirmation — sustained load anomaly active. Reason: ${decision.reason}`,
      { action: decision.action, alertId: this._loadAnomalyAlertId });

    return true;
  }

  // ── Effectiveness & Metrics ───────────────────────────────────────────────
  //
  // Wijzigingen:
  //   DATE_SUB(NOW(), INTERVAL ? DAY)    →  datetime('now', '-' || ? || ' days')
  //   DATE_SUB(CURDATE(), INTERVAL ? DAY)→  date('now', '-' || ? || ' days')
  //
  // Opmerking: history_daily bestaat niet in het huidige schema.
  // solar_forecast_accuracy gebruikt forecast_date/accuracy_pct die niet
  // overeenkomen met de huidige view-kolommen (date/accuracy_percentage).
  // De methode vangt fouten op en geeft een leeg resultaat terug.

  async getEffectiveness(strategyId, windowDays = 7) {
    try {
      const activeId = strategyId || await this._getActiveId();

      const [scoredRows] = await db.pool.query(
        `SELECT action, executed, result, context, evaluated_at
           FROM strategy_decisions
          WHERE strategy_id = ?
            AND evaluated_at >= datetime('now', '-' || ? || ' days')
            AND action != 'IDLE'
          ORDER BY evaluated_at DESC`,
        [activeId, windowDays]
      );

      let correctCount = 0;
      const decisionLog = scoredRows.map(row => {
        const score = this._getScoreForDecision(row);
        if (score.correct) correctCount++;
        return {
          evaluatedAt: row.evaluated_at,
          action:      row.action,
          executed:    row.executed,
          score:       score.label,
          correct:     score.correct,
          reason:      score.reason,
        };
      });

      const decisionAccuracyPct = scoredRows.length > 0
        ? Math.round((correctCount / scoredRows.length) * 100)
        : 100;

      // solar_forecast_accuracy view — kolom accuracy_percentage ipv accuracy_pct
      let avgForecastAccuracy = null;
      try {
        const [forecastRows] = await db.pool.query(
          `SELECT date, actual_kwh, expected_kwh, accuracy_percentage
             FROM solar_forecast_accuracy
            WHERE date >= date('now', '-' || ? || ' days')
            ORDER BY date DESC`,
          [windowDays]
        );
        avgForecastAccuracy = forecastRows.length > 0
          ? Math.round(forecastRows.reduce((sum, r) => sum + (r.accuracy_percentage ?? 0), 0) / forecastRows.length)
          : null;
      } catch { /* view niet beschikbaar — geen probleem */ }

      // history_daily bestaat nog niet — geeft lege waarden terug
      return {
        strategyId: activeId,
        windowDays,
        grid: {
          totalImportKwh:  0,
          gridImportDelta: 0,
        },
        battery: {
          avgDailyCycles:    0,
          totalChargeKwh:    0,
          totalDischargeKwh: 0,
        },
        forecast: {
          avgAccuracyPct: avgForecastAccuracy,
          trend:          [],
        },
        decisions: {
          accuracyPct: decisionAccuracyPct,
          total:       scoredRows.length,
          correct:     correctCount,
          log:         decisionLog.slice(0, 30),
        },
      };
    } catch (e) {
      console.error(`   • ${PREFIX} - Effectiveness calculation error:`, e.message);
      throw e;
    }
  }

  _getScoreForDecision(row) {
    const context = row.context;
    const action  = row.action;

    if (!row.executed) return { correct: false, label: 'Failed', reason: 'Action execution failed' };

    if (action === 'CHARGE_FROM_GRID') {
      if (context.currentPrice < 5)  return { correct: true,  label: 'Optimal',    reason: 'Charged during very low prices' };
      if (context.currentPrice < 15) return { correct: true,  label: 'Good',       reason: 'Charged during below-average prices' };
      return                                { correct: false, label: 'Sub-optimal', reason: 'Charged during high prices' };
    }

    if (action === 'DISCHARGE_TO_GRID') {
      if (context.currentPrice > 30) return { correct: true,  label: 'Optimal',    reason: 'Discharged during peak price' };
      if (context.currentPrice > 20) return { correct: true,  label: 'Good',       reason: 'Discharged during above-average price' };
      return                                { correct: false, label: 'Sub-optimal', reason: 'Discharged during low prices' };
    }

    return { correct: true, label: 'Neutral', reason: 'Action performed as requested' };
  }

  // ── Solar Curtailment ─────────────────────────────────────────────────────

  async _curtailmentWatchdog() {
    try {
      const savedState = await settings.get('strategy', 'curtailment_state');
      if (savedState === 'CURTAILED') {
        console.warn(`   • ${PREFIX} - Watchdog: server restarted while solar was curtailed — restoring to 100%`);
        const restored = await this._curtailSolar(false);
        if (!restored) {
          // Not fatal: the provider writes 100% on its first collection cycle
          // regardless of this call, and the inverter's own command-timeout
          // watchdog lifts any stale limit within a few minutes. Logged so a
          // failure here is visible rather than silent.
          console.error(`   • ${PREFIX} - Watchdog restore request was NOT accepted — ` +
                        `verify production resumed in the inverter's own app`);
        }
        await settings.upsert('strategy', 'curtailment_state', 'NORMAL', {
          changedBy: 'system', reason: 'Watchdog restore on startup', valueType: 'string',
        });
      }
      this._curtailState        = 'NORMAL';
      this._curtailPendingSince = null;
    } catch (e) {
      console.error(`   • ${PREFIX} - Curtailment watchdog error:`, e.message);
    }
  }

  async _saveCurtailState(state) {
    this._curtailState = state;
    try {
      await settings.upsert('strategy', 'curtailment_state', state, {
        changedBy: 'system', reason: 'Solar curtailment state', valueType: 'string',
      });
    } catch (e) {
      console.error(`   • ${PREFIX} - Could not persist curtailment state:`, e.message);
    }
  }

  /**
   * Request or release solar curtailment via the capability registry.
   *
   * Never references a provider module directly — after the DC-coupled
   * migration the provider may become AlphaESS rather than SolarEdge, and
   * this code should not have to change.
   *
   * The cap is expressed in WATTS, not percent. Two reasons:
   *   1. Watts can be compared against house load; a percentage of an
   *      inverter nameplate cannot.
   *   2. The previous `pct: 0` would have opened the inverter's AC output
   *      relays. Below roughly 30-60 W a single-phase SolarEdge cannot hold
   *      them closed, so it disconnects and needs a full grid-monitoring
   *      reconnect cycle before production can resume. A small non-zero cap
   *      keeps the inverter online and instantly restorable.
   *
   * NOTE: the provider records the request and applies it on its next
   * collection cycle (~20s) — it does not open its own Modbus connection.
   * So `true` here means ACCEPTED, not yet APPLIED.
   *
   * @param  {boolean} curtail   true = cap production, false = restore 100%
   * @param  {object}  config    active strategy config
   * @param  {string}  activeId  active strategy id, for provenance
   * @returns {Promise<boolean>} true when the request was accepted
   */
  async _curtailSolar(curtail, config = {}, activeId = null) {
    const handler = registry.get('solar:curtail');
    if (!handler) {
      console.warn(`   • ${PREFIX} - solar:curtail capability not available`);
      return false;
    }

    // 400 W ≈ household baseline draw. Keeps the inverter producing into the
    // house rather than exporting, without dropping its output relays.
    const targetWatts = Number.isFinite(config.curtailmentTargetWatts)
      ? config.curtailmentTargetWatts
      : 400;

    const source = `strategy:${activeId ?? 'unknown'}`;

    try {
      const result = curtail
        ? await handler({ curtail: true, watts: targetWatts, source })
        : await handler({ curtail: false, source });

      const ok = result?.success ?? false;

      if (ok) {
        console.log(
          `   • ${PREFIX} - Solar curtailment ${curtail
            ? `REQUESTED (cap ${targetWatts} W)`
            : 'RELEASE REQUESTED (100%)'} — applies within one collector cycle`
        );
      } else {
        console.error(`   • ${PREFIX} - solar:curtail returned success=false`);
      }
      return ok;
    } catch (e) {
      console.error(`   • ${PREFIX} - solar:curtail failed: `, e.message);
      return false;
    }
  }

  async _evaluateCurtailment(context, config, activeId = null) {
    try {
      const {
        negativePriceThreshold      = 0,
        curtailmentActionSocTrigger = 95,
      } = config;

      const PENDING_MINUTES    = 15;
      const RESTORE_SOC_MARGIN = 10;

      const soc        = context.soc ?? 0;
      const price      = context.currentPrice ?? 999;
      const solarPower = context.solarPowerW ?? 0;

      const conditionMet  = soc >= curtailmentActionSocTrigger && price <= negativePriceThreshold && solarPower > 50;
      const shouldRestore = price > negativePriceThreshold || soc < curtailmentActionSocTrigger - RESTORE_SOC_MARGIN;

      if (this._curtailState === 'NORMAL') {
        if (conditionMet) {
          await alertService.write('strategy', 'smart-eco', {
            type:       'solar_curtailment_pending',
            severity:   'warning',
            message:    `Battery at ${soc.toFixed(0)}% and prices negative (${price.toFixed(1)}ct). Solar export will be stopped in ${PENDING_MINUTES} minutes unless dismissed.`,
            summary:    `Battery full — solar export will pause in ${PENDING_MINUTES} min unless dismissed.`,
            suggestion: `Dismiss this alert to keep solar running. If not dismissed, Wolffie will cap solar production automatically until conditions improve.`,
            action:     'SOLAR_CURTAIL_PENDING',
          }, 20);

          this._curtailPendingSince = Date.now();
          await this._saveCurtailState('PENDING');
          console.log(`   • ${PREFIX} - Curtailment PENDING — auto-act in ${PENDING_MINUTES} min`);
        }

      } else if (this._curtailState === 'PENDING') {
        if (shouldRestore) {
          this._curtailPendingSince = null;
          await this._saveCurtailState('NORMAL');
          console.log(`   • ${PREFIX} - Curtailment PENDING cancelled — condition cleared`);

        } else if (conditionMet) {
          const pendingAlerts  = await alertService.getActive(0);
          const alertDismissed = !pendingAlerts.some(a => a.type === 'solar_curtailment_pending');
          const elapsedMin     = (Date.now() - (this._curtailPendingSince ?? Date.now())) / 60000;

          if (alertDismissed) {
            this._curtailPendingSince = null;
            await this._saveCurtailState('NORMAL');
            console.log(`   • ${PREFIX} - Curtailment PENDING — user dismissed, cancelling`);
          } else if (elapsedMin >= PENDING_MINUTES) {
            const ok = await this._curtailSolar(true, config, activeId);
            if (ok) {
              await alertService.write('strategy', 'smart-eco', {
                type:       'solar_curtailed',
                severity:   'info',
                message:    `Solar production has been capped (SoC ${soc.toFixed(0)}%, price ${price.toFixed(1)}ct). Will restore automatically when conditions improve.`,
                summary:    'Solar export paused — battery full. Will resume automatically.',
                suggestion: 'Solar will resume automatically when price recovers or battery discharges.',
                action:     'SOLAR_CURTAILED',
              }, 60);
              await alertService.resolveByTypePrefix('strategy', 'solar_curtailment_pending');
              await this._saveCurtailState('CURTAILED');
            }
          } else {
            console.log(`   • ${PREFIX} - Curtailment PENDING — ${Math.round(elapsedMin)}/${PENDING_MINUTES} min elapsed`);
          }


        }
      } else if (this._curtailState === 'CURTAILED') {
        if (shouldRestore) {
          const restored = await this._curtailSolar(false, config, activeId);

          if (!restored) {
            // Do NOT drop to NORMAL on a failed restore. That would leave
            // Wolffie believing solar is running while the inverter is still
            // capped, with nothing scheduled to retry. Staying in CURTAILED
            // means the next evaluation tries again. The inverter's own
            // command-timeout watchdog is the backstop underneath this.
            console.error(`   • ${PREFIX} - Curtailment restore NOT accepted — staying in CURTAILED to retry`);
            return;
          }

          await alertService.resolveByTypePrefix('strategy', 'solar_curtailed');
          await alertService.resolveByTypePrefix('strategy', 'solar_curtailment_pending');
          this._curtailPendingSince = null;
          await this._saveCurtailState('NORMAL');
          console.log(`   • ${PREFIX} - Curtailment RESTORED (price=${price.toFixed(1)}ct, SoC=${soc.toFixed(0)}%)`);
        } else {
          console.log(`   • ${PREFIX} - Solar remains curtailed (SoC=${soc.toFixed(0)}%, price=${price.toFixed(1)}ct)`);
        }
      }

    } catch (e) {
      console.error(`   • ${PREFIX} _evaluateCurtailment error: `, e.message);
    }
  }

  // ── Alert Management ──────────────────────────────────────────────────────

  async _writeAlert(strategyId, alert)    { await alertService.write('strategy', strategyId, alert, 60); }
  async getActiveAlerts(userId)           { return (await alertService.getActive(userId)).filter(a => a.source === 'strategy'); }
  async resolveAlert(alertId)             { await alertService.resolve(alertId); }
  async dismissAlert(alertId, userId)     { await alertService.dismiss(alertId, userId); }

  // ── Helpers ───────────────────────────────────────────────────────────────

  async _getActiveId()          { return await settings.get('strategy', 'active_strategy') ?? 'manual'; }
  async _getConfig(strategyId)  {
    const [rows] = await db.pool.query('SELECT config FROM strategy_config WHERE strategy_id = ?', [strategyId]);
    const raw = rows[0]?.config;
    if (!raw) return {};
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }
  _isAvailable(meta) { return meta.requiredCapabilities.every(c => registry.has(c)); }

  async _buildContext() {
    const planningHours = parseInt(await settings.get('strategy', 'planning_hours') ?? 24);
    const windowStart   = new Date();
    windowStart.setMinutes(Math.floor(windowStart.getMinutes() / 15) * 15, 0, 0);

    const contractType = await settings.get('energy', 'contract_type')      ?? 'dynamic';
    const fixedPriceCt = await settings.get('energy', 'fixed_price_ct_kwh') ?? 22;

    const context = {
      timestamp:       new Date().toISOString(),
      windowStart: (() => {
        const p = n => String(n).padStart(2, '0');
        return `${windowStart.getFullYear()}-${p(windowStart.getMonth()+1)}-${p(windowStart.getDate())}` +
               `T${p(windowStart.getHours())}:${p(windowStart.getMinutes())}:00`;
      })(),
      windowHours:     planningHours,
      soc:             null,
      batteryPowerW:   null,
      solarPowerW:     null,
      gridPowerW:      null,
      gridConnected:   null,
      gridStatusMode:  null,
      loadPowerW:      null,
      currentPrice:    null,
      prices:          [],
      solarForecast:   [],
      contractType,
      fixedPriceCtKwh: Number(fixedPriceCt),
    };

    const batteryHandler = registry.get('battery:read');
    if (batteryHandler) {
      try {
        const b = await batteryHandler({});
        context.soc           = b.soc;
        context.batteryPowerW = b.power;
      } catch (e) { console.warn(`   • ${PREFIX} - battery:read failed:`, e.message); }
    }

    const solarHandler = registry.get('solar:read');
    if (solarHandler) {
      try {
        const s = await solarHandler({});
        context.solarPowerW = s.total_power ?? s.power;
      } catch (e) { console.warn(`   • ${PREFIX} - solar:read failed:`, e.message); }
    }

    const gridHandler = registry.get('grid:read');
    if (gridHandler) {
      try {
        const g = await gridHandler({});
        context.gridPowerW = g.total_active_power ?? g.power;
      } catch (e) { console.warn(`   • ${PREFIX} - grid:read failed:`, e.message); }
    }

    const gridStatusHandler = registry.get('grid:status');
    if (gridStatusHandler) {
      try {
        const gs = await gridStatusHandler({});
        context.gridConnected  = gs.gridConnected;
        context.gridStatusMode = gs.mode;
      } catch (e) { console.warn(`   • ${PREFIX} - grid:status failed:`, e.message); }
    }

    const pricingHandler = registry.get('grid:pricing');
    if (pricingHandler) {
      try {
        const p = await pricingHandler({ windowStart, windowHours: planningHours });
        context.prices       = p.prices       ?? [];
        context.currentPrice = p.currentPrice ?? null;
      } catch (e) { console.warn(`   • ${PREFIX} - grid:pricing failed:`, e.message); }
    }

    const forecastHandler = registry.get('solar:forecast');
    if (forecastHandler) {
      try {
        const f = await forecastHandler({ windowStart, windowHours: planningHours });
        context.solarForecast = f.hourly ?? [];
      } catch (e) { console.warn(`   • ${PREFIX} - solar:forecast failed:`, e.message); }
    }

    // ── Derived: live load ──────────────────────────────────────────────────
    // Solar, battery, and grid power are all already fetched above for other
    // purposes — load is solar + gridImport - batteryCharge (canonical signs:
    // production/import/charging = positive).
    //
    // ⚠️ Sign trap: this is NOT the same convention as the raw Modbus
    // battery_power column SmartEco's _loadHourlyProfileFromHistory() uses.
    // That raw column is positive on DISCHARGE. battery:read here (canonical,
    // per capabilitySchemas.js) is positive on CHARGE — so the battery term
    // is subtracted here, not added.
    if (context.solarPowerW !== null || context.batteryPowerW !== null || context.gridPowerW !== null) {
      const solar   = context.solarPowerW   ?? 0;
      const battery = context.batteryPowerW ?? 0;
      const grid    = context.gridPowerW    ?? 0;
      context.loadPowerW = Math.max(0, solar + grid - battery);
    }

    return context;
  }
}

export default new StrategyManager();