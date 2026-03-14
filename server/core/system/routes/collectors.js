// core/system/routes/collectors.js
//
// Core system route — mounted directly in server.js, not via routeManager.
// routeManager handles module routes only (things in /modules/).
//
// Registration in server.js (alongside other core system routes):
//   import collectorRoutes from './core/system/routes/collectors.js';
//   app.use('/api/collectors', collectorRoutes);
//
// Endpoints:
//   GET  /api/collectors/status      – live state of all registered collectors
//   POST /api/collectors/:id/restart – unpause / force-restart a single collector

import express from 'express';
import collectorManager from '../../collectorManager.js';

const router = express.Router();

/**
 * GET /api/collectors/status
 * Returns the live schedule state for every registered collector.
 */
router.get('/status', (_req, res) => {
  try {
    const schedules = collectorManager.getSchedules();

    const toBoolean = v => v === true || v === 'true' || v === 1 || v === '1';

    const payload = schedules.map(s => ({
      id:                s.id,
      name:              s.name,
      enabled:           toBoolean(s.enabled),
      paused:            s.paused,
      intervalMs:        s.interval,
      lastRun:           s.lastRun   ?? null,
      nextRun:           s.nextRun   ?? null,
      lastError:         s.lastError ?? null,
      consecutiveErrors: s.consecutiveErrors ?? 0,
    }));

    res.json({
      ok:         true,
      running:    collectorManager.isRunning,
      count:      payload.length,
      collectors: payload,
      timestamp:  new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/collectors/:id/restart
 * Clears pause state and immediately re-runs the named collector.
 */
router.post('/:id/restart', async (req, res) => {
  try {
    await collectorManager.restart(req.params.id);
    res.json({ ok: true, message: `${req.params.id} restarted` });
  } catch (err) {
    res.status(404).json({ ok: false, error: err.message });
  }
});
/**
 * PATCH /api/collectors/:id/enabled
 * Activate or deactivate a collector at runtime.
 *
 * Body: { "enabled": true | false }
 *
 * The DB write (system_settings) must be done by the caller (module settings route)
 * before hitting this endpoint. This endpoint only drives the live collector state.
 */
router.patch('/:id/enabled', async (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ ok: false, error: '`enabled` must be a boolean' });
  }

  try {
    const result = await collectorManager.setEnabled(id, enabled);
    res.json({ ok: true, collector: result });
  } catch (err) {
    res.status(404).json({ ok: false, error: err.message });
  }
});
export default router;