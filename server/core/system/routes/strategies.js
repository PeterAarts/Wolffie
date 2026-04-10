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

router.get('/', async (req, res) => {
  try {
    const strategies = await strategyManager.listStrategies();
    res.json({ strategies });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Active strategy ───────────────────────────────────────────────────────

router.get('/active', async (req, res) => {
  try {
    const state = await strategyManager.getActiveStrategyState();
    res.json(state);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/active', async (req, res) => {
  try {
    const { strategyId } = req.body;
    if (!strategyId) return res.status(400).json({ error: 'strategyId is required' });

    const state = await strategyManager.setActiveStrategy(strategyId, 'user');
    res.json({ success: true, ...state });
  } catch (e) {
    const status = e.message.includes('not available') ? 422 : 400;
    res.status(status).json({ error: e.message });
  }
});

// ─── Day plan ──────────────────────────────────────────────────────────────

router.get('/day-plan', async (req, res) => {
  try {
    const date    = req.query.date ?? new Date().toISOString().slice(0, 10);
    const dayPlan = await strategyManager.getDayPlan(date);
    res.json({ date, plan: dayPlan });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

router.get('/decisions', async (req, res) => {
  try {
    const limit     = Math.min(parseInt(req.query.limit ?? 48), 500);
    const decisions = await strategyManager.getRecentDecisions(limit);
    res.json({ decisions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Manual evaluation ────────────────────────────────────────────────────

router.post('/evaluate', async (req, res) => {
  try {
    await strategyManager._evaluate();
    const state = await strategyManager.getActiveStrategyState();
    res.json({ success: true, ...state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Strategy config ──────────────────────────────────────────────────────
//
// Wijziging:
//   ON DUPLICATE KEY UPDATE config = ?
//   → ON CONFLICT(strategy_id) DO UPDATE SET config = excluded.config

router.post('/config', async (req, res) => {
  try {
    const activeId = await strategyManager._getActiveId();
    const incoming = req.body ?? {};

    const coerced = {};
    for (const [k, v] of Object.entries(incoming)) {
      coerced[k] = v !== '' && !isNaN(v) ? Number(v) : v;
    }

    const existing = await strategyManager._getConfig(activeId);
    const merged   = { ...existing, ...coerced };

    const db = (await import('../../database.js')).default;
    await db.pool.query(
      `INSERT INTO strategy_config (strategy_id, config)
       VALUES (?, ?)
       ON CONFLICT(strategy_id) DO UPDATE SET config = excluded.config`,
      [activeId, JSON.stringify(merged)]
    );

    await strategyManager._evaluate();
    res.json({ success: true, config: merged });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Effectiveness ─────────────────────────────────────────────────────────
//
// Wijzigingen:
//   DATE_SUB(CURDATE(), INTERVAL ? DAY)  →  date('now', '-' || ? || ' days')
//   CURDATE()                            →  date('now')
//   DATE_SUB(NOW(), INTERVAL ? DAY)      →  datetime('now', '-' || ? || ' days')
//   NOW()                                →  datetime('now')

router.get('/effectiveness', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days ?? 14), 90);
    const db   = (await import('../../database.js')).default;

    const [solarRows] = await db.pool.query(`
      SELECT
        SUM(pv_generation_kwh)     AS total_pv,
        SUM(grid_export_kwh)       AS total_export,
        SUM(grid_import_kwh)       AS total_import,
        SUM(battery_charge_kwh)    AS total_charge,
        SUM(battery_discharge_kwh) AS total_discharge
      FROM energy_daily
      WHERE date >= date('now', '-' || ? || ' days')
        AND date <  date('now')
    `, [days]);

    const s              = solarRows[0] ?? {};
    const totalPv        = parseFloat(s.total_pv)        || 0;
    const totalExport    = parseFloat(s.total_export)    || 0;
    const totalImport    = parseFloat(s.total_import)    || 0;
    const totalCharge    = parseFloat(s.total_charge)    || 0;
    const totalDischarge = parseFloat(s.total_discharge) || 0;
    const selfConsumed   = Math.max(0, totalPv - totalExport);
    const selfConsumptionPct = totalPv > 0
      ? Math.round((selfConsumed / totalPv) * 100) : null;

    const [priorRows] = await db.pool.query(`
      SELECT SUM(grid_import_kwh) AS prior_import
      FROM energy_daily
      WHERE date >= date('now', '-' || ? || ' days')
        AND date <  date('now', '-' || ? || ' days')
    `, [days * 2, days]);

    const priorImport     = parseFloat(priorRows[0]?.prior_import) || null;
    const gridImportDelta = priorImport !== null
      ? Math.round((totalImport - priorImport) * 10) / 10 : null;

    const batteryCapacityKwh = 11.2;
    const avgDailyCycles = days > 0
      ? Math.round(((totalCharge + totalDischarge) / 2 / days / batteryCapacityKwh) * 100) / 100
      : 0;

    const [forecastRows] = await db.pool.query(`
      SELECT date, expected_kwh, actual_kwh, accuracy_percentage
      FROM solar_forecasts
      WHERE date >= date('now', '-' || ? || ' days')
        AND date <  date('now')
        AND actual_kwh IS NOT NULL
      ORDER BY date ASC
    `, [days]);

    const avgForecastAccuracy = forecastRows.length > 0
      ? Math.round(
          forecastRows.reduce((sum, r) => sum + (parseFloat(r.accuracy_percentage) || 0), 0)
          / forecastRows.length
        )
      : null;

    const [decisionRows] = await db.pool.query(`
      SELECT
        sd.id,
        sd.evaluated_at,
        sd.action,
        sd.context,
        (SELECT AVG(price_eur_per_mwh)
           FROM day_ahead_prices
          WHERE date(datetime) = date(sd.evaluated_at)
        ) AS day_avg_price_mwh
      FROM strategy_decisions sd
      WHERE sd.evaluated_at >= datetime('now', '-' || ? || ' days')
        AND sd.action IN ('CHARGE_FROM_GRID', 'DISCHARGE_TO_GRID', 'IDLE')
      ORDER BY sd.evaluated_at DESC
      LIMIT 200
    `, [days]);

    const decisionLog = decisionRows.map(row => {
      const ctx = typeof row.context === 'string'
        ? JSON.parse(row.context) : (row.context ?? {});
      const priceAtDecision = ctx.currentPrice ?? null;
      const medianPriceCt   = row.day_avg_price_mwh !== null
        ? Math.round(row.day_avg_price_mwh / 10) : null;

      let correct = null;
      if (priceAtDecision !== null && medianPriceCt !== null) {
        if (row.action === 'CHARGE_FROM_GRID')       correct = priceAtDecision <= medianPriceCt;
        else if (row.action === 'DISCHARGE_TO_GRID') correct = priceAtDecision >= medianPriceCt;
      }

      return {
        date:            row.evaluated_at,
        action:          row.action,
        priceAtDecision,
        medianPrice:     medianPriceCt,
        correct,
      };
    });

    const scoredRows          = decisionLog.filter(d => d.correct !== null);
    const correctCount        = scoredRows.filter(d => d.correct).length;
    const decisionAccuracyPct = scoredRows.length > 0
      ? Math.round((correctCount / scoredRows.length) * 100) : null;

    res.json({
      period: { days },
      solar: {
        selfConsumptionPct,
        totalPvKwh:     Math.round(totalPv     * 10) / 10,
        totalExportKwh: Math.round(totalExport * 10) / 10,
      },
      grid: {
        totalImportKwh:  Math.round(totalImport * 10) / 10,
        gridImportDelta,
      },
      battery: {
        avgDailyCycles,
        totalChargeKwh:    Math.round(totalCharge    * 10) / 10,
        totalDischargeKwh: Math.round(totalDischarge * 10) / 10,
      },
      forecast: {
        avgAccuracyPct: avgForecastAccuracy,
        trend:          forecastRows,
      },
      decisions: {
        accuracyPct: decisionAccuracyPct,
        total:       scoredRows.length,
        correct:     correctCount,
        log:         decisionLog.slice(0, 30),
      },
    });
  } catch (e) {
    console.error('Effectiveness error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Alerts ───────────────────────────────────────────────────────────────

router.get('/alerts', async (req, res) => {
  try {
    const alerts = await strategyManager.getActiveAlerts();
    res.json({ alerts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/alerts/:id/resolve', async (req, res) => {
  try {
    const alertId = parseInt(req.params.id);
    if (isNaN(alertId)) return res.status(400).json({ error: 'Invalid alert id' });
    await strategyManager.resolveAlert(alertId);
    if (req.body?.execute === true) await strategyManager._evaluate();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;