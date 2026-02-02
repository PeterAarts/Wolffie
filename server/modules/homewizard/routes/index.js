import express from 'express';
import settingsSchema from '../config/settings-schema.js';
import settingsService from '../../../core/services/settingsService.js';
import deviceService from '../services/deviceService.js';

const router = express.Router();

/**
 * GET /api/homewizard/settings/schema
 * Returns UI schema + current values
 */
router.get('/settings/schema', async (req, res) => {
  try {
    // Get current settings from database
    const currentSettings = await settingsService.getModuleSettings('homewizard');
    
    // Merge schema with current values
    const schemaWithValues = mergeSchemaWithValues(settingsSchema, currentSettings);
    
    res.json({
      success: true,
      module: {
        id: 'homewizard',
        name: 'HomeWizard Integration',
        icon: 'pi-bolt',
        color: '#f59e0b'
      },
      schema: schemaWithValues
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/homewizard/settings
 * Update settings
 */
router.put('/settings', async (req, res) => {
  try {
    const { settings } = req.body;
    
    // Validate and save
    await settingsService.updateModuleSettings('homewizard', settings);
    
    res.json({ success: true, message: 'Settings updated' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/homewizard/devices
 * Get devices for table
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
 * Get single device (for edit dialog)
 */
router.get('/devices/:id', async (req, res) => {
  try {
    const device = await deviceService.getDevice(req.params.id);
    
    if (!device) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }
    
    res.json(device);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/homewizard/devices/:id
 * Update device
 */
router.put('/devices/:id', async (req, res) => {
  try {
    await deviceService.updateDevice(req.params.id, req.body);
    
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
    
    res.json({ success: true, message: 'Device deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/homewizard/devices/:id/toggle
 * Toggle device enabled status
 */
router.put('/devices/:id/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    await deviceService.updateDevice(req.params.id, { enabled });
    
    res.json({ success: true, message: 'Device toggled' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/homewizard/discover
 * Discover devices
 */
router.post('/discover', async (req, res) => {
  try {
    // Start discovery in background
    deviceService.discoverDevices();
    
    res.json({ 
      success: true, 
      message: 'Discovery started. This may take a minute.' 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/homewizard/collector/status
 * Get collector status (for info panel)
 */
router.get('/collector/status', async (req, res) => {
  try {
    const status = await collectorService.getStatus();
    
    res.json({
      isRunning: status.running,
      deviceCount: status.deviceCount,
      lastCollectionTime: status.lastCollection,
      collectionsToday: status.collectionsToday
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

function mergeSchemaWithValues(schema, currentSettings) {
  // Deep clone schema
  const merged = JSON.parse(JSON.stringify(schema));
  
  // Merge current values into fields
  merged.groups.forEach(group => {
    group.sections?.forEach(section => {
      section.fields?.forEach(field => {
        if (currentSettings[field.key] !== undefined) {
          field.value = currentSettings[field.key];
        }
      });
    });
  });
  
  return merged;
}

export default router;