// modules/day-ahead-prices/routes/index.js
import express from 'express';
import collector from '../services/collector.js';

const router = express.Router();

/**
 * GET /api/day-ahead-prices
 * Get electricity prices for a specific date
 */
router.get('/', async (req, res) => {
  try {
    const { date, biddingZone } = req.query;
    const dateStr = date || new Date().toISOString().split('T')[0];
    const zone = biddingZone || 'NL';
    
    const prices = await collector.getPricesForDate(dateStr, zone);
    
    res.json({
      date: dateStr,
      biddingZone: zone,
      hours: prices.length,
      prices
    });
  } catch (error) {
    console.error('Error getting electricity prices:', error);
    res.status(500).json({ 
      error: 'Failed to get electricity prices',
      message: error.message 
    });
  }
});

/**
 * GET /api/day-ahead-prices/summary
 * Get price summary for a date
 */
router.get('/summary', async (req, res) => {
  try {
    const { date, biddingZone } = req.query;
    const dateStr = date || new Date().toISOString().split('T')[0];
    const zone = biddingZone || 'NL';
    
    const [summary, extremes] = await Promise.all([
      collector.getPriceSummary(dateStr, zone),
      collector.getExtremeHours(dateStr, zone, 3)
    ]);
    
    res.json({
      date: dateStr,
      biddingZone: zone,
      summary,
      cheapestHours: extremes.cheapest,
      expensiveHours: extremes.expensive
    });
  } catch (error) {
    console.error('Error getting price summary:', error);
    res.status(500).json({ 
      error: 'Failed to get price summary',
      message: error.message 
    });
  }
});

/**
 * GET /api/day-ahead-prices/today
 * Get today's prices
 */
router.get('/today', async (req, res) => {
  try {
    const { biddingZone } = req.query;
    const today = new Date().toISOString().split('T')[0];
    const zone = biddingZone || 'NL';
    
    const prices = await collector.getPricesForDate(today, zone);
    
    if (prices.length === 0) {
      return res.status(404).json({ 
        error: 'No prices available for today' 
      });
    }
    
    res.json({
      date: today,
      biddingZone: zone,
      hours: prices.length,
      prices
    });
  } catch (error) {
    console.error('Error getting today\'s prices:', error);
    res.status(500).json({ 
      error: 'Failed to get today\'s prices',
      message: error.message 
    });
  }
});

/**
 * GET /api/day-ahead-prices/tomorrow
 * Get tomorrow's prices
 */
router.get('/tomorrow', async (req, res) => {
  try {
    const { biddingZone } = req.query;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    const zone = biddingZone || 'NL';
    
    const prices = await collector.getPricesForDate(tomorrowStr, zone);
    
    if (prices.length === 0) {
      return res.status(404).json({ 
        error: 'No prices available for tomorrow yet' 
      });
    }
    
    res.json({
      date: tomorrowStr,
      biddingZone: zone,
      hours: prices.length,
      prices
    });
  } catch (error) {
    console.error('Error getting tomorrow\'s prices:', error);
    res.status(500).json({ 
      error: 'Failed to get tomorrow\'s prices',
      message: error.message 
    });
  }
});

/**
 * GET /api/day-ahead-prices/cheapest
 * Get cheapest hours for a date
 */
router.get('/cheapest', async (req, res) => {
  try {
    const { date, biddingZone, count } = req.query;
    const dateStr = date || new Date().toISOString().split('T')[0];
    const zone = biddingZone || 'NL';
    const topN = parseInt(count) || 3;
    
    const extremes = await collector.getExtremeHours(dateStr, zone, topN);
    
    res.json({
      date: dateStr,
      biddingZone: zone,
      cheapestHours: extremes.cheapest
    });
  } catch (error) {
    console.error('Error getting cheapest hours:', error);
    res.status(500).json({ 
      error: 'Failed to get cheapest hours',
      message: error.message 
    });
  }
});

/**
 * GET /api/day-ahead-prices/status
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
 * POST /api/day-ahead-prices/collect
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