// modules/matter/routes/index.js
import express from 'express';
import settingsService from '../../../core/system/services/settingsService.js';
import deviceService from '../services/deviceService.js';
import matterAPI from '../services/api.js';
import collector from '../services/collector.js';

const router = express.Router();

/**
 * Helper: Resolves a device from the database by ID
 */
async function resolveDevice(req, res) {
  const device = await deviceService.getDevice(req.params.id);
  if (!device) {
    res.status(404).json({ success: false, error: 'Matter device not found' });
    return null;
  }
  return device;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEVICE CRUD
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/devices', async (req, res) => {
  try {
    const devices = await deviceService.getAllDevices();
    res.json({ success: true, data: devices });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/devices/:id', async (req, res) => {
  try {
    const device = await resolveDevice(req, res);
    if (!device) return;

    const history = await deviceService.getDailyHistory(device.id).catch(() => []);

    res.json({ success: true, settings: device, data: history });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/devices/:id', async (req, res) => {
  try {
    const device = await resolveDevice(req, res);
    if (!device) return;

    await deviceService.updateDevice(req.params.id, req.body);
    await collector.loadDevices();

    res.json({ success: true, message: 'Device updated' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/devices/:id', async (req, res) => {
  try {
    const device = await resolveDevice(req, res);
    if (!device) return;

    await deviceService.removeDevice(req.params.id);
    await collector.loadDevices();

    res.json({ success: true, message: 'Device removed and unpaired' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE DEVICE CONTROL
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/devices/:id/data', async (req, res) => {
  try {
    const device = await resolveDevice(req, res);
    if (!device) return;

    const data = await matterAPI.getDeviceAttributes(device.serial);

    res.json({ success: true, data, device: { id: device.id, name: device.name } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMMISSIONING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/matter/commission
 *
 * Body:
 *   pairingCode  {string}  Manual code (e.g. "1389-872-2385") OR QR string (e.g. "MT:AJRA21RJ01N81K1HT00")
 *   name         {string}  Friendly name for the device
 *   ipAddress    {string}  Optional. Device IP for cross-subnet commissioning (bypasses mDNS)
 *   port         {number}  Optional. Device port, defaults to 5540
 */
router.post('/commission', async (req, res) => {
  try {
    const { pairingCode, name, ipAddress, port } = req.body;

    if (!pairingCode) throw new Error("pairingCode is required (manual code or QR string)");
    if (!name)        throw new Error("name is required");

    const result = await deviceService.commissionAndAdd(pairingCode, name, ipAddress, port);

    await collector.loadDevices();

    res.json({
      success: true,
      message: `Device '${name}' commissioned successfully`,
      nodeId: result.nodeId,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS & SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/collector/status', async (req, res) => {
  try {
    const status = collector.getStatus();
    res.json({ success: true, isRunning: status.deviceCount > 0, ...status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/settings', async (req, res) => {
  try {
    const settings = await settingsService.getModuleSettings('matter');
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const { settings } = req.body;
    await settingsService.updateModuleSettings('matter', settings);
    res.json({ success: true, message: 'Matter settings updated' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;