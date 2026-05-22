// modules/alphaess-cloud/routes/index.js
import express from 'express';
import alphaessAPI from '../services/api.js';
import collector from '../services/collector.js';
import collectorManager from '../../../core/collectorManager.js';

const router = express.Router();

/**
 * GET /api/alphaess-cloud/status
 * Get module status
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
        available: alphaessAPI.isAvailable(),
        requestCount: apiStats.requestCount,
        lastRequestTime: apiStats.lastRequestTime,
        lastError: apiStats.lastError
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/alphaess-cloud/test
 * Test API connection
 */
router.post('/test', async (req, res) => {
  try {
    console.log('🔍 Testing AlphaESS Cloud API connection...');
    
    const result = await alphaessAPI.testConnection();
    
    if (result.success) {
      console.log('✅ Cloud API test successful');
      res.json({
        success: true,
        message: 'Connection successful! API credentials are valid.',
        data: result
      });
    } else {
      console.error('❌ Cloud API test failed:', result.message);
      res.status(400).json({
        success: false,
        message: result.message,
        error: result.message
      });
    }
  } catch (error) {
    console.error('❌ Cloud API test error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Connection failed',
      error: error.message
    });
  }
});

/**
 * GET /api/alphaess-cloud/latest
 * Get latest power data from API
 */
router.get('/latest', async (req, res) => {
  try {
    const data = await alphaessAPI.getLastPowerData();
    const normalized = alphaessAPI.normalizeRealTimeData(data);
    
    res.json({
      success: true,
      data: normalized,
      raw: data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/alphaess-cloud/daily/:date?
 * Get daily energy summary
 * Optional date parameter (YYYY-MM-DD), defaults to today
 */
router.get('/daily/:date?', async (req, res) => {
  try {
    const date = req.params.date || new Date().toISOString().split('T')[0];
    
    const data = await alphaessAPI.getOneDayEnergy(date);
    const normalized = alphaessAPI.normalizeDailyData(data);
    
    res.json({
      success: true,
      data: normalized,
      raw: data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/alphaess-cloud/systems
 * Get list of all ESS systems
 */
router.get('/systems', async (req, res) => {
  try {
    const systems = await alphaessAPI.getSystemList();
    
    res.json({
      success: true,
      systems
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/alphaess-cloud/charge-config
 * Get charging configuration
 */
router.get('/charge-config', async (req, res) => {
  try {
    const config = await alphaessAPI.getChargeConfig();
    
    res.json({
      success: true,
      config
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/alphaess-cloud/collect
 * Trigger manual data collection
 */
router.post('/collect', async (req, res) => {
  try {
    console.log('🔄 Manual collection triggered via API...');
    
    const success = await collector.collect();
    
    if (success) {
      res.json({
        success: true,
        message: 'Data collected successfully',
        status: collector.getStatus()
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Collection failed',
        status: collector.getStatus()
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
/**
 * GET /api/alphaess-cloud/settings
 * Haalt het schema en de huidige database-waarden op voor deze module
 */
router.get('/settings', async (req, res) => {
  try {
    // 1. Pad naar het schema bestand in de module folder
    const schemaPath = path.join(__dirname, '../config/settings-schema.json');
    
    // 2. Lees het schema (fallback naar leeg object als het niet bestaat)
    let schema = {};
    if (fs.existsSync(schemaPath)) {
      schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    }

    // 3. Haal de actuele waarden op uit de database (categorie: alphaess-cloud)
    const values = await settingsService.getCategory('alphaess-cloud');

    res.json({
      success: true,
      schema,
      values
    });
  } catch (error) {
    console.error('❌ Error fetching alphaess-cloud settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/alphaess-cloud/settings
 * Saves new values to the database, then notifies collectorManager
 * if the enabled flag changed.
 */
router.post('/settings', async (req, res) => {
  try {
    const newValues = req.body;
    await settingsService.setCategory('alphaess-cloud', newValues, req.user?.username || 'system');

    // If enabled was part of this save, notify the running collector immediately
    if ('enabled' in newValues) {
      const isEnabled = newValues.enabled === true
        || newValues.enabled === 'true'
        || newValues.enabled === '1'
        || newValues.enabled === 1;

      try {
        await collectorManager.setEnabled('alphaess-cloud', isEnabled);
        console.log(`▶ collectorManager.setEnabled('alphaess-cloud', ${isEnabled})`);
      } catch (e) {
        // Non-fatal — collector may not be registered yet
        console.warn(`⚠️  setEnabled skipped: ${e.message}`);
      }
    }

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;