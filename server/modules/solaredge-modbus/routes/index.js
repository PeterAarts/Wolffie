import express from 'express';
import api from '../services/api.js';
import collector from '../services/collector.js';
import settingsService from '../../../core/system/services/settingsService.js';

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
    // 1. Get current settings (either from DB or body if unsaved)
    const settings = await settingsService.getModuleSettings('solaredge-modbus');
    
    if (!settings || !settings.host) {
      return res.status(400).json({ 
        success: false, 
        message: 'Geen configuratie gevonden. Vul eerst de IP-gegevens in.' 
      });
    }

    // 2. Attempt connection and a quick read of the common block (Model/Serial)
    console.log(`🔍 Testing SolarEdge connection to ${settings.host}...`);
    await api.connect(settings);
    const info = await api.readBlock('common');

    res.json({
      success: true,
      message: `Verbinding geslaagd! Gevonden: ${info.manufacturer} ${info.model}`,
      data: info
    });
  } catch (error) {
    console.error('❌ SolarEdge Test Failed:', error.message);
    res.status(500).json({ 
      success: false, 
      message: `Verbinding mislukt: ${error.message}` 
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
    const { limit } = req.body; // limit in Watts, 0 = shutdown production
    const settings = await settingsService.getModuleSettings('solaredge-modbus');
    
    await api.connect(settings);
    // Write to SunSpec Power Limit Register (often 40232 or 40092 depending on model)
    await api.writeRegister(40092, limit); 

    res.json({ success: true, message: `Productie beperkt tot ${limit}W` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;