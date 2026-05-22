// modules/solar-forecast/routes/index.js
import express from 'express';
import collector from '../services/collector.js';

const router = express.Router();

// ── Named routes MUST all come before /:date ──────────────────────────────────

/**
 * GET /api/solar-forecast/today
 * Full forecast for today: daily total + hourly breakdown.
 */
router.get('/today', async (req, res) => {
  try {
    const today    = new Date().toISOString().split('T')[0];
    const forecast = await collector.getForecast(today);

    if (!forecast) {
      return res.status(404).json({ error: 'No forecast available for today' });
    }

    res.json(forecast);
  } catch (error) {
    console.error('Error getting today\'s solar forecast:', error);
    res.status(500).json({ error: 'Failed to get today\'s forecast', message: error.message });
  }
});

/**
 * GET /api/solar-forecast/accuracy
 */
router.get('/accuracy', async (req, res) => {
  try {
    const stats = await collector.getAccuracyStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting accuracy stats:', error);
    res.status(500).json({ error: 'Failed to get accuracy statistics', message: error.message });
  }
});

/**
 * GET /api/solar-forecast/status
 */
router.get('/status', async (req, res) => {
  try {
    const status = await collector.getStatus();
    res.json(status);
  } catch (error) {
    console.error('Error getting collector status:', error);
    res.status(500).json({ error: 'Failed to get status', message: error.message });
  }
});

/**
 * POST /api/solar-forecast/collect
 * Manually trigger a collection run.
 */
router.post('/collect', async (req, res) => {
  
  try {
    const result = await collector.collect();
    res.json({ success: result, message: result ? 'Collection completed' : 'Collection failed or skipped' });
  } catch (error) {
    console.error('Error triggering collection:', error);
    res.status(500).json({ error: 'Failed to trigger collection', message: error.message });
  }
});

// ── Parameterised routes AFTER all named routes ───────────────────────────────

/**
 * GET /api/solar-forecast/:date
 * Full forecast for a specific date (YYYY-MM-DD): daily total + hourly breakdown.
 */
router.get('/:date', async (req, res) => {
  try {
    const { date } = req.params;

    // Validate date format — path-to-regexp v8+ no longer supports inline regex
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const forecast = await collector.getForecast(date);

    if (!forecast) {
      return res.status(404).json({ error: `No forecast available for ${date}` });
    }

    res.json(forecast);
  } catch (error) {
    console.error(`Error getting solar forecast for ${req.params.date}:`, error);
    res.status(500).json({ error: 'Failed to get forecast', message: error.message });
  }
});

/**
 * GET /api/solar-forecast
 * Query params:
 *   ?date=YYYY-MM-DD           → single date with hourly breakdown
 *   ?startDate=…&endDate=…     → date range (daily summaries only)
 *   (no params)                → today + next 7 days (daily summaries)
 */
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, date } = req.query;

    let result;

    if (date) {
      result = await collector.getForecast(date);
      if (!result) return res.status(404).json({ error: `No forecast for ${date}` });
    } else {
      const start = startDate || new Date().toISOString().split('T')[0];
      const end   = endDate   || (() => {
        const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split('T')[0];
      })();
      result = await collector.getForecastRange(start, end);
    }

    res.json(result);
  } catch (error) {
    console.error('Error getting solar forecast range:', error);
    res.status(500).json({ error: 'Failed to get solar forecast', message: error.message });
  }
});

export default router;