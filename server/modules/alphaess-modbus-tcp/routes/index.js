// modules/alphaess-modbus-tcp/routes/index.js
import express from 'express';
import api from '../services/api.js';
import settingsService from '../../../core/system/services/settingsService.js';

const router = express.Router();

// ─── Dispatch Status ───────────────────────────────────────────────────────
//
// Registered BEFORE the connection middleware so the UI status bar keeps
// working even when the inverter is temporarily offline.
//
// GET /api/alphaess-modbus-tcp/dispatch-status
// Pure in-memory read — no Modbus I/O.

router.get('/dispatch-status', (req, res) => {
  res.json(api.getDispatchStatus());
});

// ─── Connection Middleware ─────────────────────────────────────────────────
//
// Ensures the ModBus client is connected using the latest database settings
// before processing any request that touches the inverter.

router.use(async (req, res, next) => {
  try {
    const config = await settingsService.getModuleSettings('alphaess-modbus-tcp');
    if (!config || !config.enabled) {
      return res.status(403).json({ error: 'AlphaESS ModBus module is disabled' });
    }
    await api.connect(config.host, config.port, config.unit_id);
    next();
  } catch (e) {
    res.status(503).json({
      error: 'Inverter Connection Failed',
      message: 'Could not establish ModBus TCP connection. Ensure the inverter is on the network.',
    });
  }
});

// ─── Read Routes ───────────────────────────────────────────────────────────

/**
 * GET /api/alphaess-modbus-tcp/metrics
 * Returns full real-time data for the UI.
 */
router.get('/metrics', async (req, res) => {
  try {
    const metrics = await api.fetchAll();
    res.json(metrics);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch metrics', message: e.message });
  }
});

// ─── Timed Dispatch Routes ─────────────────────────────────────────────────

/**
 * POST /api/alphaess-modbus-tcp/charge
 * Start a timed charge-from-grid session.
 * Body: { "watts": 2000, "targetSOC": 100, "durationHours": 4 }
 */
router.post('/charge', async (req, res) => {
  try {
    const { watts, targetSOC, durationHours } = req.body;
    await api.startCharge(watts, targetSOC, durationHours, 'manual:api');
    res.json({ success: true, command: { mode: 'charge', watts, targetSOC, durationHours } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/alphaess-modbus-tcp/discharge
 * Start a timed discharge-to-grid session.
 * Body: { "watts": 2000, "minimumSOC": 20, "durationHours": 2 }
 */
router.post('/discharge', async (req, res) => {
  try {
    const { watts, minimumSOC, durationHours } = req.body;
    await api.startDischarge(watts, minimumSOC, durationHours, 'manual:api');
    res.json({ success: true, command: { mode: 'discharge', watts, minimumSOC, durationHours } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/alphaess-modbus-tcp/stop
 * Cancel active dispatch and return inverter to Self-Consumption mode.
 */
router.post('/stop', async (req, res) => {
  try {
    await api.stopDispatch();
    res.json({ success: true, mode: 'Self-Consumption' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Hardware Control Routes ───────────────────────────────────────────────

/**
 * POST /api/alphaess-modbus-tcp/ups-control
 * Enable or Disable the UPS (Backup) function.
 * Body: { "enabled": true/false }
 */
router.post('/ups-control', async (req, res) => {
  try {
    const { enabled } = req.body;
    await api.writeUPS(enabled ? 1 : 0);
    res.json({ success: true, ups_enabled: enabled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/alphaess-modbus-tcp/soc-limits
 * Sets hardware-level SoC limits (Min SoC / Backup Reserve and Battery DoD).
 * Body: { "minSoc": 20, "dod": 90 }
 */
router.post('/soc-limits', async (req, res) => {
  try {
    const { minSoc, dod } = req.body;
    if (minSoc !== undefined) await api.writeMinSoC(minSoc);
    if (dod !== undefined)    await api.writeDoD(dod);
    res.json({ success: true, limits: { minSoc, dod } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/alphaess-modbus-tcp/zero-export
 * Toggles the Zero Export mode.
 * Body: { "enabled": true/false }
 */
router.post('/zero-export', async (req, res) => {
  try {
    const limit = req.body.enabled ? 0 : 100;
    await api.writeLimit(limit);
    res.json({ success: true, export_limit: limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/alphaess-modbus-tcp/dispatch
 * Low-level dispatch — charge or discharge without a duration timer.
 * Use /charge and /discharge for UI-initiated commands with auto-stop.
 * Body: { "mode": "charge"|"discharge", "watts": 3000, "targetSoc": 80 }
 */
router.post('/dispatch', async (req, res) => {
  try {
    const { mode, watts, targetSoc } = req.body;
    await api.setDispatch(mode, watts, targetSoc);
    res.json({ success: true, command: { mode, watts, targetSoc } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/alphaess-modbus-tcp/reset-auto
 * Returns the inverter to standard Self-Consumption mode.
 * Also clears any active dispatch timer.
 */
router.post('/reset-auto', async (req, res) => {
  try {
    await api.stopDispatch();
    res.json({ success: true, mode: 'Self-Consumption' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;