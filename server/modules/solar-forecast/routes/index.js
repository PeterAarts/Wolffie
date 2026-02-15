// modules/solar-forecast/routes/index.js
import express from 'express';
import collector from '../services/collector.js';

const router = express.Router();

/**
 * GET /api/solar-forecast
 * Get solar forecast data for date range
 */
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, date } = req.query;
    
    let result;
    
    if (date) {
      // Single date
      result = await collector.getForecast(date);
    } else if (startDate && endDate) {
      // Date range
      result = await collector.getForecastRange(startDate, endDate);
    } else {
      // Default: today + next 7 days
      const today = new Date().toISOString().split('T')[0];
      const weekLater = new Date();
      weekLater.setDate(weekLater.getDate() + 7);
      const endDateStr = weekLater.toISOString().split('T')[0];
      
      result = await collector.getForecastRange(today, endDateStr);
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error getting solar forecast:', error);
    res.status(500).json({ 
      error: 'Failed to get solar forecast',
      message: error.message 
    });
  }
});

/**
 * GET /api/solar-forecast/accuracy
 * Get forecast accuracy statistics
 */
router.get('/accuracy', async (req, res) => {
  try {
    const stats = await collector.getAccuracyStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting accuracy stats:', error);
    res.status(500).json({ 
      error: 'Failed to get accuracy statistics',
      message: error.message 
    });
  }
});

/**
 * GET /api/solar-forecast/today
 * Get today's forecast
 */
router.get('/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const forecast = await collector.getForecast(today);
    
    if (!forecast) {
      return res.status(404).json({ 
        error: 'No forecast available for today' 
      });
    }
    
    res.json(forecast);
  } catch (error) {
    console.error('Error getting today\'s forecast:', error);
    res.status(500).json({ 
      error: 'Failed to get today\'s forecast',
      message: error.message 
    });
  }
});

/**
 * GET /api/solar-forecast/status
 * Get collector status
 */
router.get('/status', (req, res) => {
  try {
    const status = collector.getStatus();
    res.json(status);
  } catch (error) {
    console.error('Error getting collector status:', error);
    res.status(500).json({ 
      error: 'Failed to get collector status',
      message: error.message 
    });
  }
});

/**
 * POST /api/solar-forecast/collect
 * Manually trigger collection
 */
router.post('/collect', async (req, res) => {
  try {
    const settings = req.body.settings || {};
    const result = await collector.collect(settings);
    
    res.json({
      success: result.success,
      message: result.success ? 'Collection completed' : 'Collection failed',
      ...result
    });
  } catch (error) {
    console.error('Error triggering collection:', error);
    res.status(500).json({ 
      error: 'Failed to trigger collection',
      message: error.message 
    });
  }
});

export default router;