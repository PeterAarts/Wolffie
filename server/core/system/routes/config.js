// server/core/system/routes/config.js
import express from 'express';
import systemConfigService from '../services/systemConfigService.js';
import { authorize } from '../../auth/middleware/authorize.js';

const router = express.Router();

/**
 * GET /api/system/config
 * Get all system configuration
 */
router.get('/', async (req, res) => {
  try {
    const setupCompleted = await systemConfigService.isSetupCompleted();
    const selectedModel = await systemConfigService.getSelectedModel();
    const setupStep = await systemConfigService.get('setup_step');
    const manufacturer = await systemConfigService.get('modbus_manufacturer');
    const modelName = await systemConfigService.get('modbus_model_name');
    
    const config = {
      setupCompleted,
      setupStep: setupStep ? Number(setupStep) : 1,
      selectedModel,
      manufacturer,
      modelName
    };
    
    res.json({ 
      success: true, 
      config 
    });
  } catch (error) {
    console.error('Error getting system config:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/system/config/:key
 * Get specific config value
 */
router.get('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const value = await systemConfigService.get(key);
    
    if (value === null) {
      return res.status(404).json({ 
        success: false, 
        error: 'Configuration key not found' 
      });
    }
    
    res.json({ 
      success: true, 
      key,
      value 
    });
  } catch (error) {
    console.error(`Error getting config ${req.params.key}:`, error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * PUT /api/system/config/:key
 * Update config value (admin only)
 */
router.put('/:key', authorize('admin'), async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    
    if (value === undefined) {
      return res.status(400).json({ 
        success: false, 
        error: 'Value is required' 
      });
    }
    
    await systemConfigService.set(key, value);
    
    res.json({ 
      success: true, 
      message: `Configuration '${key}' updated`,
      key,
      value
    });
  } catch (error) {
    console.error(`Error setting config ${req.params.key}:`, error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/system/config/category/:category
 * Get all config in a category
 */
router.get('/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const config = await systemConfigService.getCategory(category);
    
    res.json({ 
      success: true, 
      category,
      config 
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
 * POST /api/system/config/cache/clear
 * Clear config cache (admin only)
 */
router.post('/cache/clear', authorize('admin'), async (req, res) => {
  try {
    systemConfigService.clearCache();
    
    res.json({ 
      success: true, 
      message: 'System configuration cache cleared' 
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/system/health
 * System health check
 */
router.get('/health', async (req, res) => {
  try {
    const setupCompleted = await systemConfigService.isSetupCompleted();
    const selectedModel = await systemConfigService.getSelectedModel();
    
    const health = {
      status: 'healthy',
      database: 'connected',
      setupCompleted,
      hasModel: selectedModel !== null,
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    };
    
    res.json({ 
      success: true, 
      ...health 
    });
  } catch (error) {
    console.error('Error checking health:', error);
    res.status(500).json({ 
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;