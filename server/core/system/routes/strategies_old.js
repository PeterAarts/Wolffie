// core/routes/strategies.js
//
// Strategy Manager API
// Mount in server.js: app.use('/api/strategies', strategyRoutes)
//
// GET  /api/strategies              — all strategies + available/active flags
// GET  /api/strategies/active       — active strategy state + day plan
// POST /api/strategies/active       — { strategyId } — switch strategy
// GET  /api/strategies/day-plan     — today's hourly plan (for chart)
// GET  /api/strategies/decisions    — recent decision log
// POST /api/strategies/evaluate     — trigger manual evaluation (debug)
// POST /api/strategies/day-plan/regenerate — force day plan regeneration

import express         from 'express';
import strategyManager from '../../strategyManager.js';

const router = express.Router();

// ─── List all strategies ───────────────────────────────────────────────────

/**
 * GET /api/strategies
 * Returns all known strategies with availability and active flags.
 * The frontend uses this to render the strategy selector and
 * grey out unavailable options.
 *
 * Response:
 * {
 *   strategies: [
 *     {
 *       id, name, description, active, available,
 *       requiredCapabilities, optionalCapabilities, activeOptional
 *     }
 *   ]
 * }
 */
router.get('/', async (req, res) => {
  try {
    const strategies = await strategyManager.listStrategies();
    res.json({ strategies });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Active strategy ───────────────────────────────────────────────────────

/**
 * GET /api/strategies/active
 * Returns the active strategy, its current config, latest decision,
 * and today's day plan.
 *
 * Response:
 * {
 *   strategy: { id, name, description, config, available },
 *   decision: { action, reason, evaluatedAt, executed },
 *   dayPlan:  [{ hour, action, watts, reason, priceCtKwh, solarForecastW }]
 * }
 */
router.get('/active', async (req, res) => {
  try {
    const state = await strategyManager.getActiveStrategyState();
    res.json(state);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/strategies/active
 * Switch the active strategy.
 * Body: { strategyId: 'smart-eco' }
 *
 * Returns the new active strategy state (same shape as GET /active).
 * Triggers immediate re-evaluation and day plan regeneration.
 */
router.post('/active', async (req, res) => {
  try {
    const { strategyId } = req.body;
    if (!strategyId) {
      return res.status(400).json({ error: 'strategyId is required' });
    }

    const state = await strategyManager.setActiveStrategy(strategyId, 'user');
    res.json({ success: true, ...state });
  } catch (e) {
    // setActiveStrategy throws descriptive errors for unknown/unavailable strategies
    const status = e.message.includes('not available') ? 422 : 400;
    res.status(status).json({ error: e.message });
  }
});

// ─── Day plan ──────────────────────────────────────────────────────────────

/**
 * GET /api/strategies/day-plan?date=YYYY-MM-DD
 * Returns the hourly day plan for the given date (defaults to today).
 * This is the data source for the Energy Outlook chart.
 *
 * Response:
 * {
 *   date, strategyId, generatedAt,
 *   plan: [{ hour, action, watts, reason, priceCtKwh, solarForecastW }]
 * }
 */
router.get('/day-plan', async (req, res) => {
  try {
    const date    = req.query.date ?? new Date().toISOString().slice(0, 10);
    const dayPlan = await strategyManager.getDayPlan(date);
    res.json({ date, plan: dayPlan });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/strategies/day-plan/regenerate
 * Force regeneration of the day plan for today (or a given date).
 * Body: { date?: 'YYYY-MM-DD' }
 *
 * Used after new price data arrives or after a strategy change.
 */
router.post('/day-plan/regenerate', async (req, res) => {
  try {
    const date = req.body?.date ?? null;
    await strategyManager.regenerateDayPlan(date);
    const dayPlan = await strategyManager.getDayPlan(date);
    res.json({ success: true, date: date ?? new Date().toISOString().slice(0, 10), plan: dayPlan });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Decision log ──────────────────────────────────────────────────────────

/**
 * GET /api/strategies/decisions?limit=48
 * Returns recent strategy decisions for the Events view.
 *
 * Response:
 * {
 *   decisions: [{ evaluatedAt, strategyId, action, reason, executed, context, result }]
 * }
 */
router.get('/decisions', async (req, res) => {
  try {
    const limit     = Math.min(parseInt(req.query.limit ?? 48), 500);
    const decisions = await strategyManager.getRecentDecisions(limit);
    res.json({ decisions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Manual evaluation (debug) ────────────────────────────────────────────

/**
 * POST /api/strategies/evaluate
 * Trigger an immediate evaluation cycle outside the normal schedule.
 * Useful for testing strategy logic without waiting for the timer.
 */
router.post('/evaluate', async (req, res) => {
  try {
    await strategyManager._evaluate();
    const state = await strategyManager.getActiveStrategyState();
    res.json({ success: true, ...state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Strategy alerts ──────────────────────────────────────────────────────

/**
 * GET /api/strategies/alerts
 * Returns all unresolved strategy alerts, newest first.
 * Polled by the dashboard banner every 5 minutes.
 *
 * Response:
 * { alerts: [{ id, strategy_id, type, severity, message, suggestion, action, created_at }] }
 */
router.get('/alerts', async (req, res) => {
  try {
    const alerts = await strategyManager.getActiveAlerts();
    res.json({ alerts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/strategies/alerts/:id/resolve
 * Mark an alert as resolved. Called when user dismisses or confirms action.
 * Body: { execute?: true } — if true, also triggers an immediate evaluation
 * so the strategy can act on the confirmation right away.
 *
 * Response: { success: true }
 */
router.post('/alerts/:id/resolve', async (req, res) => {
  try {
    const alertId = parseInt(req.params.id);
    if (isNaN(alertId)) {
      return res.status(400).json({ error: 'Invalid alert id' });
    }

    await strategyManager.resolveAlert(alertId);

    // If the user confirmed action, trigger immediate evaluation
    if (req.body?.execute === true) {
      await strategyManager._evaluate();
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;