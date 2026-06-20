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

      if (!strategy) {
        console.warn(`   • ${PREFIX} - No strategy implementation for '${activeId}'`);
        return;
      }

      const context = await this._buildContext();
      const config  = await this._getConfig(activeId);

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
        await this._evaluateCurtailment(context, config);
      }

      if (autoExecute && decision.action !== 'IDLE') {
        await this._execute(decision, decisionId, activeId);
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
        await this._curtailSolar(false);
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

  async _curtailSolar(curtail) {
    const handler = registry.get('solar:curtail');
    if (!handler) {
      console.warn(`   • ${PREFIX} - solar:curtail capability not available`);
      return false;
    }
    try {
      const result = await handler({ enabled: !curtail, pct: curtail ? 0 : 100 });
      console.log(`   • ${PREFIX} - Solar curtailment ${curtail ? 'ACTIVE (0%)' : 'RESTORED (100%)'}`);
      return result?.success ?? true;
    } catch (e) {
      console.error(`   • ${PREFIX} - solar:curtail failed: `, e.message);
      return false;
    }
  }

  async _evaluateCurtailment(context, config) {
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
            suggestion: `Dismiss this alert to keep solar running. If not dismissed, Wolffie will set the SolarEdge export limit to 0% automatically.`,
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
            console.log(`   • ${PREFIX} - Curtailment PENDING — ${Math.round(elapsedMin)}/${PENDING_MINUTES} min elapsed`);
          }


        }
      } else if (this._curtailState === 'CURTAILED') {
        if (shouldRestore) {
          await this._curtailSolar(false);
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

    return context;
  }
}

export default new StrategyManager();