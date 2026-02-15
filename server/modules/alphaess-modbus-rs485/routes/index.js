// modules/alphaess-modbus-rs485/routes/index.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import alphaessAPI from '../services/api.js';
import collector from '../services/collector.js';
import settingsService from '../../../core/system/services/settingsService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

/**
 * GET /api/alphaess-modbus-rs485/status
 */
router.get('/status', async (req, res) => {
  try {
    const collectorStatus = collector.getStatus();
    const apiStats = alphaessAPI.getStats();

    res.json({
      collector: {
        lastCollection: collectorStatus.lastCollection,
        lastError: collectorStatus.lastError,
        consecutiveErrors: collectorStatus.consecutiveErrors,
        healthy: collectorStatus.consecutiveErrors < 3
      },
      api: {
        connected: alphaessAPI.isConnected,
        lastRequestTime: apiStats.lastRequestTime,
        lastError: apiStats.lastError
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/alphaess-modbus-rs485/test
 */
router.post('/test', async (req, res) => {
  try {
    console.log('🔍 Testing AlphaESS ModBus RS485 connection...');
    const result = await alphaessAPI.testConnection();
    
    if (result.success) {
      res.json({ success: true, message: 'Connection successful!', data: result.data });
    } else {
      res.status(400).json({ success: false, message: result.message });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/alphaess-modbus-rs485/latest
 */
router.get('/latest', async (req, res) => {
  try {
    const data = await alphaessAPI.getRealtimeData();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/alphaess-modbus-rs485/settings
 */
router.get('/settings', async (req, res) => {
  try {
    const schemaPath = path.join(__dirname, '../config/settings-schema.json');
    let schema = {};
    if (fs.existsSync(schemaPath)) {
      schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    }
    const values = await settingsService.getCategory('alphaess-modbus-rs485');
    res.json({ success: true, schema, values });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/alphaess-modbus-rs485/settings
 */
router.post('/settings', async (req, res) => {
  try {
    await settingsService.setCategory('alphaess-modbus-rs485', req.body, req.user?.username || 'system');
    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;