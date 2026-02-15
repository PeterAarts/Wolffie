// modules/homewizard/routes/index.js
import express from 'express';
import settingsService from '../../../core/system/services/settingsService.js';
import deviceService from '../services/deviceService.js';
import collector from '../services/collector.js';

const router = express.Router();

/**
 * GET /api/homewizard/devices
 * Get all devices
 */
router.get('/devices', async (req, res) => {
  try {
    const devices = await deviceService.getAllDevices();
    
    res.json({
      success: true,
      data: devices
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/homewizard/devices/:id
 * Get single device
 */
router.get('/devices/:id', async (req, res) => {
  try {
    const device = await deviceService.getDevice(req.params.id);
    
    if (!device) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }
    
    res.json({ success: true, data: device });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/homewizard/devices
 * Add new device
 */
router.post('/devices', async (req, res) => {
  try {
    const id = await deviceService.addDevice(req.body);
    
    res.json({ success: true, id, message: 'Device added' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/homewizard/devices/:id
 * Update device
 */
router.put('/devices/:id', async (req, res) => {
  try {
    await deviceService.updateDevice(req.params.id, req.body);
    
    // Reload devices in collector
    await collector.reloadDevices();
    
    res.json({ success: true, message: 'Device updated' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/homewizard/devices/:id
 * Delete device
 */
router.delete('/devices/:id', async (req, res) => {
  try {
    await deviceService.deleteDevice(req.params.id);
    
    // Reload devices in collector
    await collector.reloadDevices();
    
    res.json({ success: true, message: 'Device deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/homewizard/discover
 * Discover devices on network
 */
router.post('/discover', async (req, res) => {
  try {
    const count = await deviceService.discoverDevices();
    
    // Reload devices in collector
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

/**
 * GET /api/homewizard/collector/status
 * Get collector status
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

/**
 * GET /api/homewizard/devices/stats
 * Get device statistics
 */
router.get('/devices/stats', async (req, res) => {
  try {
    const devices = await deviceService.getAllDevices();
    
    res.json({
      success: true,
      totalDevices: devices.length,
      enabledDevices: devices.filter(d => d.enabled).length,
      totalPower: 0 // TODO: Calculate from recent measurements if needed
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/homewizard/settings
 * Get module settings
 */
router.get('/settings', async (req, res) => {
  try {
    const settings = await settingsService.getModuleSettings('homewizard');
    
    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/homewizard/settings
 * Update module settings
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

/**
 * GET /api/homewizard/devices/:id/state
 * Get device state (power_on, switch_lock)
 */
router.get('/devices/:id/state', async (req, res) => {
  try {
    const device = await deviceService.getDevice(req.params.id);
    
    if (!device) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }

    const homewizardAPI = (await import('../services/api.js')).default;
    const state = await homewizardAPI.getState(device.ip_address, device.port || 80);
    
    res.json({ 
      success: true, 
      data: state,
      device: {
        id: device.id,
        name: device.name,
        product_type: device.product_type
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/homewizard/devices/:id/state
 * Set device state (control power switch and lock)
 * 
 * Body examples:
 * - Turn on: { "power_on": true }
 * - Turn off: { "power_on": false }
 * - Lock switch: { "switch_lock": true }
 * - Turn on and lock: { "power_on": true, "switch_lock": true }
 */
router.put('/devices/:id/state', async (req, res) => {
  try {
    const device = await deviceService.getDevice(req.params.id);
    
    if (!device) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }

    const { power_on, switch_lock } = req.body;
    const state = {};

    if (power_on !== undefined) {
      state.power_on = Boolean(power_on);
    }

    if (switch_lock !== undefined) {
      state.switch_lock = Boolean(switch_lock);
    }

    if (Object.keys(state).length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Must provide power_on and/or switch_lock' 
      });
    }

    const homewizardAPI = (await import('../services/api.js')).default;
    const result = await homewizardAPI.setState(device.ip_address, device.port || 80, state);
    
    res.json({ 
      success: true, 
      message: 'Device state updated',
      data: result,
      device: {
        id: device.id,
        name: device.name
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/homewizard/devices/:id/identify
 * Identify device (blink LED)
 */
router.post('/devices/:id/identify', async (req, res) => {
  try {
    const device = await deviceService.getDevice(req.params.id);
    
    if (!device) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }

    const homewizardAPI = (await import('../services/api.js')).default;
    await homewizardAPI.identify(device.ip_address, device.port || 80);
    
    res.json({ 
      success: true, 
      message: 'Device identification triggered (LED blinking)',
      device: {
        id: device.id,
        name: device.name
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;