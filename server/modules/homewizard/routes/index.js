// modules/homewizard/routes/index.js
import express from 'express';
import settingsService from '../../../core/system/services/settingsService.js';
import deviceService from '../services/deviceService.js';
import homewizardAPI from '../services/api.js';
import collector from '../services/collector.js';

const router = express.Router();


// ─── Helper ───────────────────────────────────────────────────────────────────
// Resolves a device or sends 404. Keeps route handlers DRY.
async function resolveDevice(req, res) {
  const device = await deviceService.getDevice(req.params.id);
  if (!device) {
    res.status(404).json({ success: false, error: 'Device not found' });
    return null;
  }
  return device;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEVICE CRUD  (persisted in device_settings table via deviceService)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/homewizard/devices
 * List all devices, each enriched with today's daily usage stats.
 */
router.get('/devices', async (req, res) => {
  try {
    const devices = await deviceService.getAllDevices();

    // Enrich with daily usage (non-blocking per device – failures → null stats)
    const enriched = await Promise.all(
      devices.map(async (device) => {
        const stats = await deviceService.getDailyStats(device.id).catch(() => ({
          firstReadingToday: null,
          latestReading: null,
          dailyUsedPower: null
        }));
        return { ...device, stats };
      })
    );

    res.json({ success: true, data: enriched });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/homewizard/devices/stats
 * Aggregate stats across all devices.
 * NOTE: must be declared BEFORE /devices/:id so Express doesn't swallow 'stats' as an id.
 */
router.get('/devices/stats', async (req, res) => {
  try {
    const devices = await deviceService.getAllDevices();

    res.json({
      success: true,
      totalDevices: devices.length,
      enabledDevices: devices.filter(d => d.enabled).length,
      totalPower: 0 // populated from recent measurements when collector exposes it
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});



/**
 * GET /api/homewizard/device/:id
 * Returns a unified object containing device settings and historical measurements.
 */
router.get('/devices/:id', async (req, res) => {
  try {
    const device = await resolveDevice(req, res);
    if (!device) return;

    // Fetch daily power history for the chart
    const history = await deviceService.getDailyHistory(device.id).catch(() => []);

    // Fetch calculated daily stats (usage_today, etc.)
    const stats = await deviceService.getDailyStats(device.id).catch(() => ({
      usage_today: 0,
      first_reading: null,
      latest_reading: null
    }));

    res.json({ 
      success: true, 
      settings: { 
        ...device, 
        usage_today: stats.dailyUsedPower / 1000 // Convert Wh to kWh if needed
      },
      data: history // Array of { timestamp, power }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/homewizard/devices
 * Add a new device.
 * Body: { name, ip_address, port?, serial?, product_type?, priority?, enabled? }
 */
router.post('/devices', async (req, res) => {
  try {
    const id = await deviceService.addDevice(req.body);
    await collector.reloadDevices();

    res.status(201).json({ success: true, id, message: 'Device added' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/homewizard/devices/:id
 * Update device DB record (name, ip_address, port, enabled, priority …).
 * Does NOT push live settings to the physical device – use /state or /system for that.
 * Body: any subset of { name, ip_address, port, serial, product_type, priority, enabled }
 */
router.put('/devices/:id', async (req, res) => {
  try {
    const device = await resolveDevice(req, res);
    if (!device) return;

    await deviceService.updateDevice(req.params.id, req.body);
    await collector.reloadDevices();

    res.json({ success: true, message: 'Device updated' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/homewizard/devices/:id
 * Remove a device.
 */
router.delete('/devices/:id', async (req, res) => {
  try {
    const device = await resolveDevice(req, res);
    if (!device) return;

    await deviceService.deleteDevice(req.params.id);
    await collector.reloadDevices();

    res.json({ success: true, message: 'Device deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE DEVICE CONTROL  (via homewizardAPI → physical device)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/homewizard/devices/:id/state
 * Fetch live power_on + switch_lock from the physical device.
 */
router.get('/devices/:id/state', async (req, res) => {
  try {
    const device = await resolveDevice(req, res);
    if (!device) return;

    const state = await homewizardAPI.getState(device.ip_address, device.port || 80);

    res.json({
      success: true,
      data: state,
      device: { id: device.id, name: device.name, product_type: device.product_type }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/homewizard/devices/:id/state
 * Set power_on, switch_lock, and/or brightness on the physical device.
 *
 * Body examples:
 * { "power_on": true }
 * { "brightness": 150 }
 * { "power_on": true, "brightness": 255, "switch_lock": false }
 */

router.put('/devices/:id/state', async (req, res) => {
  try {
    const device = await resolveDevice(req, res);
    if (!device) return;

    const { power_on, switch_lock, brightness } = req.body;
    const state = {};

    // Map fields and ensure types match HomeWizard expectations
    if (power_on !== undefined)   state.power_on   = Boolean(power_on);
    if (switch_lock !== undefined) state.switch_lock = Boolean(switch_lock);
    
    // Process brightness (0-255)
    if (brightness !== undefined) {
      state.brightness = parseInt(brightness);
    }

    if (Object.keys(state).length === 0) {
      return res.status(400).json({ success: false, error: 'Must provide state data' });
    }

    // Call the service (ensure validKeys is updated there too!)
    const result = await homewizardAPI.setState(device.ip_address, device.port || 80, state);

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


/**
 * GET /api/homewizard/devices/:id/system
 * Fetch live system info from the physical device (firmware, status_led_brightness_pct, …).
 */
router.get('/devices/:id/system', async (req, res) => {
  try {
    const device = await resolveDevice(req, res);
    if (!device) return;

    const system = await homewizardAPI.getSystem(device.ip_address, device.port || 80);

    res.json({
      success: true,
      data: system,
      device: { id: device.id, name: device.name, product_type: device.product_type }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


/**
 * GET /api/homewizard/devices/:id/data
 * Fetch live measurement data from the physical device (power_w, total_power_import_kwh, …).
 */
router.get('/devices/:id/data', async (req, res) => {
  try {
    const device = await resolveDevice(req, res);
    if (!device) return;

    const data = await homewizardAPI.getData(device.ip_address, device.port || 80);

    res.json({
      success: true,
      data,
      device: { id: device.id, name: device.name }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/homewizard/devices/:id/identify
 * Blink the device LED for identification.
 */
router.post('/devices/:id/identify', async (req, res) => {
  try {
    const device = await resolveDevice(req, res);
    if (!device) return;

    await homewizardAPI.identify(device.ip_address, device.port || 80);

    res.json({
      success: true,
      message: 'Device identification triggered (LED blinking)',
      device: { id: device.id, name: device.name }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/homewizard/discover
 * Scan local network for HomeWizard devices and persist new ones.
 */
router.post('/discover', async (req, res) => {
  try {
    const count = await deviceService.discoverDevices();
    await collector.reloadDevices();

    res.json({
      success: true,
      message: `Discovery complete. Found ${count} device(s).`,
      count
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTOR STATUS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/homewizard/collector/status
 */
router.get('/collector/status', async (req, res) => {
  try {
    const status = collector.getStatus();

    res.json({
      success: true,
      isRunning: status.deviceCount > 0,
      deviceCount: status.deviceCount,
      lastCollectionTime: status.lastCollection,
      lastError: status.lastError,
      consecutiveErrors: status.consecutiveErrors
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/homewizard/settings
 */
router.get('/settings', async (req, res) => {
  try {
    const settings = await settingsService.getModuleSettings('homewizard');
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/homewizard/settings
 * Body: { "settings": { … } }
 */
router.put('/settings', async (req, res) => {
  try {
    const { settings } = req.body;
    await settingsService.updateModuleSettings('homewizard', settings);
    res.json({ success: true, message: 'Settings updated' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;