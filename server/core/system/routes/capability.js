// core/system/routes/capability.js
//
// Unified API surface for all capability-based operations.
// The frontend always calls these endpoints — it never calls module-specific
// routes directly for business operations.
//
// Mount in server.js:
//   import capabilityRouter from './core/capabilityRouter.js';
//   app.use('/api/capability', capabilityRouter);
//
// All routes follow the same delegation pattern:
//   1. Look up the handler in capabilityRegistry
//   2. If not found → 503 with capability name so the frontend knows what's missing
//   3. If found → call handler(req.body, req) and return the result

import express from 'express';
import registry from '../../capabilityRegistry.js';
import { normalize } from '../../capabilitySchemas.js';
import eventLog from '../services/eventLogService.js';

const router = express.Router();

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Wraps a capability dispatch in consistent error handling.
 * Looks up `type` in the registry, calls the handler, returns JSON.
 */
async function dispatch(type, req, res) {
  const handler = registry.get(type);

  if (!handler) {
    return res.status(503).json({
      error:      'capability_unavailable',
      capability: type,
      message:    `No module currently provides '${type}'. Enable the required module in Settings.`,
    });
  }

  try {
    const raw    = await handler(req.body, req);
    const result = normalize(type, raw);
    res.json(result ?? { success: true });
  } catch (e) {
    console.error(`[CapabilityRouter] Error executing '${type}':`, e.message);
    res.status(500).json({
      error:      'capability_error',
      capability: type,
      message:    e.message,
    });
  }
}

// ─── Introspection ─────────────────────────────────────────────────────────

/**
 * GET /api/capabilities
 * Returns all currently available capability types and their provider module.
 * The frontend uses this to conditionally show/hide controls.
 *
 * Response: { capabilities: [{ type, moduleId, priority }] }
 */
router.get('/', (req, res) => {
  res.json({ capabilities: registry.list() });
});

// ─── Battery ───────────────────────────────────────────────────────────────

/**
 * GET /api/capability/battery/read
 * Full real-time battery metrics (SoC, power, energy today, etc.)
 */
router.get('/battery/read', (req, res) =>
  dispatch('battery:read', req, res)
);

/**
 * GET /api/capability/battery/status
 * Current dispatch state (active, mode, watts, remainingSeconds).
 * Lightweight — backed by in-memory state, no hardware I/O.
 */
router.get('/battery/status', (req, res) =>
  dispatch('battery:status', req, res)
);

/**
 * POST /api/capability/battery/charge-from-grid
 * Start a timed charge-from-grid session.
 * Body: { watts: number, targetSOC: number, durationHours: number }
 */
router.post('/battery/charge-from-grid', async (req, res) => {
  const type = 'battery:charge-from-grid';
  const handler = registry.get(type);
  if (!handler) {
    return res.status(503).json({
      error: 'capability_unavailable', capability: type,
      message: `No module currently provides '${type}'. Enable the required module in Settings.`,
    });
  }

  try {
    const raw    = await handler(req.body, req);
    const result = normalize(type, raw);

    // Resolve any prior active dispatch events, then log the new one
    await eventLog.resolveByCategory('dispatch');
    await eventLog.log('manual:api', 'dispatch', 'charge_started', 'notice',
      `Grid charging started at ${req.body.watts ?? '?'}W (target ${req.body.targetSOC ?? '?'}%, ${req.body.durationHours ?? '?'}h)`,
      { watts: req.body.watts, targetSOC: req.body.targetSOC, durationHours: req.body.durationHours });

    res.json(result ?? { success: true });
  } catch (e) {
    console.error(`[CapabilityRouter] Error executing '${type}':`, e.message);
    await eventLog.log('manual:api', 'dispatch', 'charge_failed', 'error',
      `Grid charge failed: ${e.message}`, { watts: req.body.watts });
    res.status(500).json({ error: 'capability_error', capability: type, message: e.message });
  }
});

/**
 * POST /api/capability/battery/discharge-to-grid
 * Start a timed discharge-to-grid session.
 * Body: { watts: number, minimumSOC: number, durationHours: number }
 */
router.post('/battery/discharge-to-grid', async (req, res) => {
  const type = 'battery:discharge-to-grid';
  const handler = registry.get(type);
  if (!handler) {
    return res.status(503).json({
      error: 'capability_unavailable', capability: type,
      message: `No module currently provides '${type}'. Enable the required module in Settings.`,
    });
  }

  try {
    const raw    = await handler(req.body, req);
    const result = normalize(type, raw);

    await eventLog.resolveByCategory('dispatch');
    await eventLog.log('manual:api', 'dispatch', 'discharge_started', 'notice',
      `Discharge started at ${req.body.watts ?? '?'}W (min SoC ${req.body.minimumSOC ?? '?'}%, ${req.body.durationHours ?? '?'}h)`,
      { watts: req.body.watts, minimumSOC: req.body.minimumSOC, durationHours: req.body.durationHours });

    res.json(result ?? { success: true });
  } catch (e) {
    console.error(`[CapabilityRouter] Error executing '${type}':`, e.message);
    await eventLog.log('manual:api', 'dispatch', 'discharge_failed', 'error',
      `Discharge failed: ${e.message}`, { watts: req.body.watts });
    res.status(500).json({ error: 'capability_error', capability: type, message: e.message });
  }
});

/**
 * POST /api/capability/battery/stop
 * Cancel active dispatch and return inverter to Self-Consumption mode.
 */
router.post('/battery/stop', async (req, res) => {
  const type = 'battery:stop';
  const handler = registry.get(type);
  if (!handler) {
    return res.status(503).json({
      error: 'capability_unavailable', capability: type,
      message: `No module currently provides '${type}'. Enable the required module in Settings.`,
    });
  }

  try {
    const raw    = await handler(req.body, req);
    const result = normalize(type, raw);

    // Resolve all active dispatch events — dispatch is over
    const resolved = await eventLog.resolveByCategory('dispatch');
    await eventLog.log('manual:api', 'dispatch', 'dispatch_stopped', 'info',
      `Dispatch stopped — inverter returned to self-consumption`,
      { resolvedEvents: resolved });

    res.json(result ?? { success: true });
  } catch (e) {
    console.error(`[CapabilityRouter] Error executing '${type}':`, e.message);
    await eventLog.log('manual:api', 'dispatch', 'stop_failed', 'error',
      `Dispatch stop failed: ${e.message}`);
    res.status(500).json({ error: 'capability_error', capability: type, message: e.message });
  }
});

// ─── Solar ─────────────────────────────────────────────────────────────────

/**
 * GET /api/capability/solar/read
 * Real-time solar production metrics.
 */
router.get('/solar/read', (req, res) =>
  dispatch('solar:read', req, res)
);

/**
 * GET /api/capability/solar/forecast
 * Solar yield forecast for today and tomorrow.
 */
router.get('/solar/forecast', (req, res) =>
  dispatch('solar:forecast', req, res)
);

/**
 * GET /api/capability/solar/curtail/status
 * Current curtailment state (active, targetWatts, verifiedPct, remainingSeconds).
 * Lightweight — backed by in-memory state, no hardware I/O.
 *
 * Declared BEFORE the POST /solar/curtail route for readability only; Express
 * matches on method + path so ordering is not significant here.
 */
router.get('/solar/curtail/status', (req, res) =>
  dispatch('solar:curtail-status', req, res)
);

/**
 * POST /api/capability/solar/curtail
 * Request a production cap on the solar inverter.
 * Body: { watts: number, durationHours?: number, source?: string }
 *
 * The provider records the request and applies it on its next collection
 * cycle (~20s) — it deliberately does not open its own connection to the
 * inverter. A 202-style "accepted, applying shortly" is the honest reading
 * of the response, but 200 is kept for consistency with the battery routes.
 */
router.post('/solar/curtail', async (req, res) => {
  const type = 'solar:curtail';
  const handler = registry.get(type);
  if (!handler) {
    return res.status(503).json({
      error: 'capability_unavailable', capability: type,
      message: `No module currently provides '${type}'. Enable the required module in Settings.`,
    });
  }

  try {
    // Force the curtail flag on this route regardless of body shape, so a
    // malformed body can never turn a curtail request into a release.
    const body = { ...req.body, curtail: true, source: req.body?.source ?? 'manual' };

    const raw    = await handler(body, req);
    const result = normalize(type, raw);

    await eventLog.resolveByCategory('curtailment');
    await eventLog.log('manual:api', 'curtailment', 'curtail_started', 'notice',
      `Solar curtailment requested at ${req.body?.watts ?? '?'}W` +
      (req.body?.durationHours ? ` for ${req.body.durationHours}h` : ' (no expiry)'),
      { watts: req.body?.watts, durationHours: req.body?.durationHours, source: body.source });

    res.json(result ?? { success: true });
  } catch (e) {
    console.error(`[CapabilityRouter] Error executing '${type}':`, e.message);
    await eventLog.log('manual:api', 'curtailment', 'curtail_failed', 'error',
      `Solar curtailment failed: ${e.message}`, { watts: req.body?.watts });
    res.status(500).json({ error: 'capability_error', capability: type, message: e.message });
  }
});

/**
 * POST /api/capability/solar/curtail/stop
 * Release any active curtailment. The provider writes 100% on its next cycle.
 *
 * Note: even if this call fails, the inverter's own command-timeout watchdog
 * restores production on its own. This route is the fast path, not the only
 * safety net.
 */
router.post('/solar/curtail/stop', async (req, res) => {
  const type = 'solar:curtail';
  const handler = registry.get(type);
  if (!handler) {
    return res.status(503).json({
      error: 'capability_unavailable', capability: type,
      message: `No module currently provides '${type}'. Enable the required module in Settings.`,
    });
  }

  try {
    const raw    = await handler({ curtail: false, source: req.body?.source ?? 'manual' }, req);
    const result = normalize(type, raw);

    const resolved = await eventLog.resolveByCategory('curtailment');
    await eventLog.log('manual:api', 'curtailment', 'curtail_stopped', 'info',
      'Solar curtailment released — inverter returning to full output',
      { resolvedEvents: resolved });

    res.json(result ?? { success: true });
  } catch (e) {
    console.error(`[CapabilityRouter] Error executing '${type}' (stop):`, e.message);
    await eventLog.log('manual:api', 'curtailment', 'curtail_stop_failed', 'error',
      `Solar curtailment stop failed: ${e.message}`);
    res.status(500).json({ error: 'capability_error', capability: type, message: e.message });
  }
});

// ─── Grid ──────────────────────────────────────────────────────────────────

/**
 * GET /api/capability/grid/read
 * Real-time grid metrics (import/export power, voltage).
 */
router.get('/grid/read', (req, res) =>
  dispatch('grid:read', req, res)
);

/**
 * GET /api/capability/grid/pricing
 * Day-ahead electricity prices.
 */
router.get('/grid/pricing', (req, res) =>
  dispatch('grid:pricing', req, res)
);

// ─── Home ──────────────────────────────────────────────────────────────────

/**
 * GET /api/capability/home/read
 * Home load metrics (power, energy today).
 * Provided at priority 5 by AlphaESS (derived), priority 10 by P1 meter (measured).
 */
router.get('/home/read', (req, res) =>
  dispatch('home:read', req, res)
);

// ─── Devices ───────────────────────────────────────────────────────────────

/**
 * GET /api/capability/devices/read
 * List of all managed smart devices and their current state.
 */
router.get('/devices/read', (req, res) =>
  dispatch('devices:read', req, res)
);

/**
 * POST /api/capability/devices/:id/control
 * Control a specific device.
 * Body: { action: 'on'|'off'|'toggle', power?: number }
 */
router.post('/devices/:id/control', (req, res) => {
  // Merge the route param into the body so the handler receives everything
  req.body.deviceId = req.params.id;
  dispatch('devices:control', req, res);
});

export default router;