// modules/push-notifications/routes/index.js
import express from 'express';
import sender from '../services/sender.js';
import settingsService from '../../../core/system/services/settingsService.js';

const router = express.Router();
const MODULE_ID = 'push-notifications';

// GET /api/push/vapid-public-key — frontend needs this for PushManager.subscribe()
router.get('/vapid-public-key', async (req, res) => {
  try {
    const config = await settingsService.getCategory(MODULE_ID);
    if (!config?.vapid_public_key) {
      return res.status(503).json({ error: 'Push not configured yet' });
    }
    res.json({ publicKey: config.vapid_public_key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/push/subscribe — body: { subscription: PushSubscriptionJSON, label?: string }
router.post('/subscribe', async (req, res) => {
  try {
    const { subscription, label } = req.body;
    if (!subscription) return res.status(400).json({ error: 'Missing subscription' });
    await sender.subscribe(subscription, label ?? null);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/push/subscribe — body: { endpoint: string }
router.delete('/subscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
    await sender.unsubscribe(endpoint);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/push/status — used by settings_schema.json's info-panel
router.get('/status', async (req, res) => {
  try {
    const config = await settingsService.getCategory(MODULE_ID);
    const subscriptionCount = await sender.getSubscriptionCount();
    res.json({
      vapidPublicKey: config?.vapid_public_key ?? null,
      subscriptionCount,
      lastSent:  sender.lastSent,
      lastError: sender.lastError,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;