import express from 'express';
import api from '../services/api.js';
import collector from '../services/collector.js';
import settingsService from '../../../core/system/services/settingsService.js';
import db from '../../../core/database.js';

const router = express.Router();

/**
 * GET /api/solaredge-modbus/status
 * Returns the current live status and last collected data
 */
router.get('/status', (req, res) => {
  try {
    const status = collector.getStatus();
    res.json({
      success: true,
      data: {
        ...status,
        module: 'solaredge-modbus'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/solaredge-modbus/test
 * Triggered by the "Test Verbinding" button in the settings UI
 */
router.post('/test', async (req, res) => {
  try {
    // 1. Load settings from DB
    const settings = await settingsService.getCategory('solaredge-modbus');

    const host = settings?.host || settings?.ip_address;
    if (!settings || !host) {
      return res.status(400).json({
        success: false,
        message: 'No configuration found. Please fill in the connection details first.'
      });
    }

    // 2. Force a fresh connection (close any existing one first)
    try { api.client.close(); } catch (_) {}

    console.log(`\u{1F50D} Testing SolarEdge connection to ${host}:${settings.port}...`);
    await api.connect(settings);

    // 3. Read common block for device identification (manufacturer, model, serial)
    const info = await api.readBlock('common');

    // 4. Close after test so the collector reconnects on its own schedule
    try { api.client.close(); } catch (_) {}

    // 5. Persist device info as readonly rows in system_settings
    const deviceFields = {
      device_manufacturer: info.manufacturer || '',
      device_model:        info.model        || '',
      device_version:      info.version      || '',
      device_serial:       info.serial       || '',
    };
    try {
      for (const [key, value] of Object.entries(deviceFields)) {
        await db.pool.query(
          `INSERT INTO system_settings
             (category, setting_key, setting_value, value_type, is_module, module_id, editable, visible)
           VALUES (?, ?, ?, 'string', 1, 'solaredge-modbus', 0, 1)
           ON DUPLICATE KEY UPDATE
             setting_value = VALUES(setting_value),
             editable      = 0,
             updated_at    = NOW()`,
          ['solaredge-modbus', key, value]
        );
      }
      console.log('✓ SolarEdge device info saved to system_settings');
    } catch (dbErr) {
      console.error('❌ Failed to save device info to DB:', dbErr.message);
    }

    const label = [info.manufacturer, info.model].filter(Boolean).join(' ') || 'Unknown device';
    res.json({
      success: true,
      message: `Connection successful — ${label} (S/N: ${info.serial || 'unknown'})`,
      data: info
    });
  } catch (error) {
    try { api.client.close(); } catch (_) {}
    console.error('\u274C SolarEdge Test Failed:', error.message);
    res.status(500).json({
      success: false,
      message: `Connection failed: ${error.message}`
    });
  }
});

/**
 * GET /api/solaredge-modbus/latest
 * Returns the most recent normalized snapshot
 */
router.get('/latest', (req, res) => {
  if (!collector.lastData) {
    return res.status(404).json({ success: false, message: 'Nog geen gegevens verzameld.' });
  }
  res.json({
    success: true,
    data: collector.lastData
  });
});

/**
 * POST /api/solaredge-modbus/curtail
 * Disables or limits production during negative price events
 */
router.post('/curtail', async (req, res) => {
  try {
    const { percentage } = req.body; // 0–100, where 0 = stop production
    if (percentage === undefined || percentage < 0 || percentage > 100) {
      return res.status(400).json({ success: false, message: 'percentage must be 0–100' });
    }

    const settings = await settingsService.getCategory('solaredge-modbus');
    await api.connect(settings);
    await api.setPowerLimit(percentage);

    res.json({ success: true, message: `Production limited to ${percentage}%` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;