// core/system/routes/events.js
//
// Event log API — read event history, get active alerts, resolve events.
//
// Endpoints:
//   GET  /api/events              — paginated history with filters
//   GET  /api/events/active       — active (unresolved) events above alert threshold
//   POST /api/events/:id/resolve  — resolve a specific event
//
// Mounted in server.js:
//   import eventRoutes from './core/system/routes/events.js';
//   app.use('/api/events', eventRoutes);

import express from 'express';
import eventLog from '../services/eventLogService.js';

const router = express.Router();

/**
 * GET /api/events
 *
 * Paginated event history with optional filters.
 *
 * Query params:
 *   category    — filter by category (e.g. 'dispatch', 'collector')
 *   source      — filter by source (exact match, or prefix with * e.g. 'strategy:*')
 *   severity    — minimum severity (e.g. 'warning' returns warning + error + critical)
 *   from        — ISO date or datetime lower bound (e.g. '2026-06-01')
 *   to          — ISO date or datetime upper bound
 *   limit       — page size (default 50, max 500)
 *   offset      — pagination offset (default 0)
 */
router.get('/', async (req, res) => {
  try {
    const { category, source, severity, from, to, limit, offset } = req.query;

    const result = await eventLog.getHistory({
      category:  category || undefined,
      source:    source   || undefined,
      severity:  severity || undefined,
      from:      from     || undefined,
      to:        to       || undefined,
      limit:     limit  ? parseInt(limit, 10)  : undefined,
      offset:    offset ? parseInt(offset, 10) : undefined,
    });

    res.json({
      ok:     true,
      ...result,
      alertThreshold: eventLog.alertThreshold,
      timestamp:      new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/events/active
 *
 * Returns all unresolved events at or above the configured alert threshold.
 * This is the endpoint the dashboard polls to surface active alerts.
 *
 * Query params:
 *   severity  — override minimum severity (default: configured alert_threshold)
 */
router.get('/active', async (req, res) => {
  try {
    const { severity } = req.query;
    const events = await eventLog.getActive(severity || undefined);

    res.json({
      ok:             true,
      count:          events.length,
      events,
      alertThreshold: eventLog.alertThreshold,
      timestamp:      new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/events/categories
 *
 * Returns the list of valid event categories and severity levels.
 * Useful for building filter UIs.
 */
router.get('/categories', (_req, res) => {
  res.json({
    ok:             true,
    categories:     eventLog.validCategories,
    severityLevels: eventLog.severityLevels,
    alertThreshold: eventLog.alertThreshold,
  });
});

/**
 * POST /api/events/:id/resolve
 *
 * Resolve (close) a specific active event.
 */
router.post('/:id/resolve', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid event id' });
    }

    const resolved = await eventLog.resolve(id);
    if (!resolved) {
      return res.status(404).json({ ok: false, error: 'Event not found or already resolved' });
    }

    res.json({ ok: true, message: `Event ${id} resolved` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;