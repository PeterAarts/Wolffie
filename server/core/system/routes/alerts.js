// core/routes/alertRoutes.js
//
// Generic alert endpoints.
// Mounted at /api/alerts in server.js.
//
// GET  /api/alerts                — fetch active alerts for current user
// POST /api/alerts/:id/dismiss    — per-user dismiss
// POST /api/alerts/:id/resolve    — global resolve (admin only)

import express from 'express';
import alertService from '../services/alertService.js';
import db from '../../database.js';
import { authorize } from '../../auth/middleware/authorize.js';

const router = express.Router();

// ── GET /api/alerts/history ────────────────────────────────────────────────
// Returns resolved alerts (auto_resolved = 1), newest first, last 100.
// Includes alerts dismissed by the requesting user via the dismissals table.

router.get('/history', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const [rows] = await db.pool.query(
      `SELECT
         a.id, a.source, a.source_id, a.type, a.severity,
         a.message, a.suggestion, a.action,
         a.created_at, a.resolved_at,
         MAX(d.dismissed_at) AS dismissed_at
       FROM app_alerts a
       LEFT JOIN app_alert_dismissals d
         ON d.alert_id = a.id AND d.user_id = ?
       WHERE a.auto_resolved = 1
          OR d.alert_id IS NOT NULL
       GROUP BY a.id
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [userId]
    );

    res.json({ alerts: rows });
  } catch (e) {
    console.error('GET /api/alerts/history error:', e.message);
    res.status(500).json({ error: 'Failed to fetch alert history' });
  }
});

// ── GET /api/alerts ────────────────────────────────────────────────────────
// Returns unresolved alerts not yet dismissed by the requesting user.
// Optional query param: ?source=strategy to filter by source.

router.get('/', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    let alerts = await alertService.getActive(userId);

    // Optional source filter
    if (req.query.source) {
      alerts = alerts.filter(a => a.source === req.query.source);
    }

    res.json({ alerts });
  } catch (e) {
    console.error('GET /api/alerts error:', e.message);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// ── POST /api/alerts/:id/dismiss ───────────────────────────────────────────
// Dismisses an alert for the requesting user only.
// Other users continue to see the alert.

router.post('/:id/dismiss', async (req, res) => {
  try {
    const alertId = parseInt(req.params.id, 10);
    const userId  = req.user?.id;

    if (!alertId || !userId) return res.status(400).json({ error: 'Invalid request' });

    await alertService.dismiss(alertId, userId);
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/alerts/:id/dismiss error:', e.message);
    res.status(500).json({ error: 'Failed to dismiss alert' });
  }
});

// ── POST /api/alerts/:id/resolve ───────────────────────────────────────────
// Globally resolves an alert — clears it for all users.
// Restricted to admin role.

router.post('/:id/resolve', authorize('admin'), async (req, res) => {
  try {
    const alertId = parseInt(req.params.id, 10);
    if (!alertId) return res.status(400).json({ error: 'Invalid alert id' });

    await alertService.resolve(alertId);
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/alerts/:id/resolve error:', e.message);
    res.status(500).json({ error: 'Failed to resolve alert' });
  }
});

export default router;