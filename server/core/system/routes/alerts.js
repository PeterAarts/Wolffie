// core/routes/alertRoutes.js
//
// Generic alert endpoints.
// Mounted at /api/alerts in server.js.
//
// GET  /api/alerts                — fetch active alerts for current user
// POST /api/alerts/:id/dismiss    — per-user dismiss
// POST /api/alerts/:id/respond    — per-user confirm/decline (held actions)
// POST /api/alerts/:id/resolve    — global resolve (admin only)

import express from 'express';
import alertService from '../services/alertService.js';
import db from '../../database.js';
import { authorize } from '../../auth/middleware/authorize.js';

const router = express.Router();

// ── GET /api/alerts/history ────────────────────────────────────────────────
// Returns resolved alerts (auto_resolved = 1), newest first, last 100.
// Includes alerts dismissed by the requesting user via the dismissals table,
// and the requesting user's response (confirmed/declined) if they answered
// a held-action alert before it resolved.

router.get('/history', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const [rows] = await db.pool.query(
      `SELECT
         a.id, a.source, a.source_id, a.type, a.severity,
         a.message, a.suggestion, a.action,
         a.created_at, a.resolved_at,
         MAX(d.dismissed_at) AS dismissed_at,
         MAX(r.response)     AS user_response
       FROM app_alerts a
       LEFT JOIN app_alert_dismissals d
         ON d.alert_id = a.id AND d.user_id = ?
       LEFT JOIN app_alert_responses r
         ON r.alert_id = a.id AND r.user_id = ?
       WHERE a.auto_resolved = 1
          OR d.alert_id IS NOT NULL
       GROUP BY a.id
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [userId, userId]
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
// Each alert includes user_response (null while pending) for held actions.

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

// ── POST /api/alerts/:id/respond ───────────────────────────────────────────
// Records an explicit confirm/decline for an alert that's holding a pending
// strategy action (e.g. the load-anomaly or UPS-mode dispatch holds in
// strategyManager). Deliberately NOT admin-gated — this is the requesting
// user answering a question about their own system, not a moderation action.
// Distinct from dismiss/resolve; see alertService.respond() for why.
//
// Body: { response: 'confirmed' | 'declined' }

router.post('/:id/respond', async (req, res) => {
  try {
    const alertId  = parseInt(req.params.id, 10);
    const userId   = req.user?.id;
    const response  = req.body?.response;

    if (!alertId || !userId) return res.status(400).json({ error: 'Invalid request' });
    if (response !== 'confirmed' && response !== 'declined') {
      return res.status(400).json({ error: "response must be 'confirmed' or 'declined'" });
    }

    await alertService.respond(alertId, userId, response);
    res.json({ ok: true, response });
  } catch (e) {
    console.error('POST /api/alerts/:id/respond error:', e.message);
    res.status(500).json({ error: 'Failed to record response' });
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