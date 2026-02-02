// server/core/system/routes/data.js
// Simple data routes - just the data, no unnecessary metadata
import express from 'express';
import db from '../../database.js';

const router = express.Router();

/**
 * GET /api/system/collector-status
 * Simple status: are we getting data?
 */
router.get('/collector-status', async (req, res) => {
  try {
    const [recent] = await db.pool.query(
      'SELECT timestamp FROM energy_snapshots ORDER BY timestamp DESC LIMIT 1'
    );

    if (recent.length === 0) {
      return res.json({
        connected: false,
        message: 'No data yet'
      });
    }

    const lastUpdate = new Date(recent[0].timestamp);
    const ageMs = Date.now() - lastUpdate.getTime();
    const ageSec = Math.floor(ageMs / 1000);
    const isConnected = ageMs < 300000; // Less than 5 minutes = connected

    res.json({
      connected: isConnected,
      lastUpdate: lastUpdate.toISOString(),
      ageSeconds: ageSec
    });
  } catch (error) {
    console.error('Error getting collector status:', error);
    res.json({
      connected: false,
      error: error.message
    });
  }
});

/**
 * GET /api/system/realtime
 * Current power values (W)
 */
router.get('/realtime', async (req, res) => {
  try {
    const [snapshots] = await db.pool.query(
      `SELECT 
        battery_soc,
        battery_power,
        solar_power,
        grid_power,
        load_power,
        timestamp
      FROM energy_snapshots 
      ORDER BY timestamp DESC 
      LIMIT 1`
    );

    if (snapshots.length === 0) {
      return res.status(503).json({
        error: 'No data available'
      });
    }

    const s = snapshots[0];

    res.json({
      timestamp: s.timestamp,
      battery: {
        soc: parseFloat(s.battery_soc) || 0,
        power: parseFloat(s.battery_power) || 0
      },
      solar: {
        total: parseFloat(s.solar_power) || 0,
        pv1: 0, // Not in schema
        pv2: 0,
        pv3: 0
      },
      grid: {
        power: parseFloat(s.grid_power) || 0
      },
      home: {
        power: parseFloat(s.load_power) || 0
      }
    });
  } catch (error) {
    console.error('Error getting realtime data:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/system/summary
 * Complete dashboard data: today's totals + latest snapshot + collector status
 * This is called ONCE on dashboard load, then WebSocket takes over
 */
router.get('/summary', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // 1. Get today's energy totals (kWh)
    const [dailyData] = await db.pool.query(
      `SELECT 
        pv_generation_kwh,
        load_consumption_kwh,
        grid_import_kwh,
        grid_export_kwh,
        battery_charge_kwh,
        battery_discharge_kwh,
        date
      FROM energy_daily 
      WHERE date = ?`,
      [today]
    );

    // 2. Get latest snapshot (current power in W)
    const [snapshots] = await db.pool.query(
      `SELECT 
        battery_soc,
        battery_power,
        solar_power,
        grid_power,
        load_power,
        timestamp
      FROM energy_snapshots 
      ORDER BY timestamp DESC 
      LIMIT 1`
    );

    // 3. Check collector status
    const hasSnapshot = snapshots.length > 0;
    const lastUpdate = hasSnapshot ? new Date(snapshots[0].timestamp) : null;
    const dataAge = hasSnapshot ? Date.now() - lastUpdate.getTime() : null;
    const isConnected = dataAge ? dataAge < 300000 : false; // Less than 5 minutes

    // 4. Build response
    const daily = dailyData[0] || {
      pv_generation_kwh: 0,
      load_consumption_kwh: 0,
      grid_import_kwh: 0,
      grid_export_kwh: 0,
      battery_charge_kwh: 0,
      battery_discharge_kwh: 0
    };

    const snapshot = snapshots[0] || {
      battery_soc: 0,
      battery_power: 0,
      solar_power: 0,
      grid_power: 0,
      load_power: 0
    };

    // Calculate environmental impact
    const totalPvGeneration = parseFloat(daily.pv_generation_kwh) || 0;
    const co2Saved = totalPvGeneration * 0.527; // kg CO2 per kWh
    const treesSaved = totalPvGeneration * 0.06; // trees equivalent

    res.json({
      // Collector status
      collector: {
        connected: isConnected,
        lastUpdate: lastUpdate ? lastUpdate.toISOString() : null,
        ageSeconds: dataAge ? Math.floor(dataAge / 1000) : null
      },

      // Today's accumulated energy (kWh)
      today: {
        pv_generation: parseFloat(daily.pv_generation_kwh) || 0,
        load_consumption: parseFloat(daily.load_consumption_kwh) || 0,
        grid_import: parseFloat(daily.grid_import_kwh) || 0,
        grid_export: parseFloat(daily.grid_export_kwh) || 0,
        battery_charge: parseFloat(daily.battery_charge_kwh) || 0,
        battery_discharge: parseFloat(daily.battery_discharge_kwh) || 0
      },

      // Current real-time values (W)
      realtime: {
        timestamp: snapshot.timestamp,
        battery: {
          soc: parseFloat(snapshot.battery_soc) || 0,
          power: parseFloat(snapshot.battery_power) || 0
        },
        solar: {
          total: parseFloat(snapshot.solar_power) || 0,
          pv1: 0, // Not in current schema
          pv2: 0, // Not in current schema
          pv3: 0  // Not in current schema
        },
        grid: {
          power: parseFloat(snapshot.grid_power) || 0
        },
        home: {
          power: parseFloat(snapshot.load_power) || 0
        }
      },

      // Environmental impact
      environmental: {
        co2_saved: parseFloat(co2Saved.toFixed(2)),
        trees_equivalent: parseFloat(treesSaved.toFixed(2))
      }
    });
  } catch (error) {
    console.error('Error getting summary:', error);
    res.status(500).json({ 
      error: error.message,
      collector: { connected: false },
      today: {},
      realtime: {},
      environmental: {}
    });
  }
});

/**
 * GET /api/history/today?granularity=15
 * Today's history data at specified granularity
 */
router.get('/history/today', async (req, res) => {
  try {
    const granularity = parseInt(req.query.granularity) || 15; // minutes
    const today = new Date().toISOString().split('T')[0];

    // Get aggregated data for today
    const [data] = await db.pool.query(
      `SELECT 
        timestamp,
        battery_soc,
        battery_power,
        solar_power,
        grid_power,
        load_power
      FROM energy_snapshots
      WHERE DATE(timestamp) = ?
      ORDER BY timestamp ASC`,
      [today]
    );

    // Group by granularity
    const grouped = [];
    const intervalMs = granularity * 60 * 1000;
    
    for (let i = 0; i < data.length; i++) {
      const point = data[i];
      const ts = new Date(point.timestamp).getTime();
      const bucket = Math.floor(ts / intervalMs) * intervalMs;
      
      let group = grouped.find(g => g.timestamp === bucket);
      if (!group) {
        group = {
          timestamp: new Date(bucket).toISOString(),
          battery_soc: [],
          battery_power: [],
          solar_power: [],
          grid_power: [],
          load_power: []
        };
        grouped.push(group);
      }
      
      group.battery_soc.push(parseFloat(point.battery_soc) || 0);
      group.battery_power.push(parseFloat(point.battery_power) || 0);
      group.solar_power.push(parseFloat(point.solar_power) || 0);
      group.grid_power.push(parseFloat(point.grid_power) || 0);
      group.load_power.push(parseFloat(point.load_power) || 0);
    }

    // Average each group
    const result = grouped.map(g => ({
      timestamp: g.timestamp,
      battery: {
        soc: avg(g.battery_soc),
        power: avg(g.battery_power)
      },
      solar: avg(g.solar_power),
      grid: avg(g.grid_power),
      home: avg(g.load_power)
    }));

    res.json({
      date: today,
      granularity,
      data: result
    });
  } catch (error) {
    console.error('Error getting history:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function
function avg(arr) {
  if (arr.length === 0) return 0;
  return parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2));
}

export default router;