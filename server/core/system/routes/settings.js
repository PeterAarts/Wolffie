// server/core/system/routes/settings.js
import express from 'express';
import settingsService from '../services/settingsService.js';
import { authorize } from '../../auth/middleware/authorize.js';

const router = express.Router();

/**
 * GET /api/settings/category/:category
 * Get all settings in a category
 */
router.get('/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const settings = await settingsService.getCategory(category);
    
    res.json({ 
      success: true,
      ...settings 
    });
  } catch (error) {
    console.error(`Error getting category ${req.params.category}:`, error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * POST /api/settings/modbus
 * Update ModBus settings
 */
router.post('/modbus', authorize('admin'), async (req, res) => {
  try {
    const { ip_address, port, slave_id, enabled } = req.body;
    
    const updates = {};
    if (ip_address !== undefined) updates.ip_address = ip_address;
    if (port !== undefined) updates.port = port;
    if (slave_id !== undefined) updates.slave_id = slave_id;
    if (enabled !== undefined) updates.enabled = enabled;

    await settingsService.setCategory('modbus', updates, req.user.username, 'Updated via API');
    
    res.json({ 
      success: true,
      message: 'ModBus settings updated' 
    });
  } catch (error) {
    console.error('Error updating ModBus settings:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * POST /api/settings/cloud-api
 * Update Cloud API settings
 */
router.post('/cloud-api', authorize('admin'), async (req, res) => {
  try {
    const { app_id, app_secret, system_sn, endpoint_url, enabled } = req.body;
    
    const updates = {};
    if (app_id !== undefined) updates.app_id = app_id;
    if (app_secret !== undefined) updates.app_secret = app_secret;
    if (system_sn !== undefined) updates.system_sn = system_sn;
    if (endpoint_url !== undefined) updates.endpoint_url = endpoint_url;
    if (enabled !== undefined) updates.enabled = enabled;

    await settingsService.setCategory('cloud_api', updates, req.user.username, 'Updated via API');
    
    res.json({ 
      success: true,
      message: 'Cloud API settings updated' 
    });
  } catch (error) {
    console.error('Error updating Cloud API settings:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

export default router;