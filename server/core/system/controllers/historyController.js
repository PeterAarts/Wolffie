// server/controllers/historyController.js
import db from '../../database.js';

class HistoryController {
  /**
   * GET /api/history/today?granularity=15
   * Get today's data aggregated by granularity (minutes)
   * Returns flat structure matching original format
   */
  async getToday(req, res) {
    try {
      const granularity = parseInt(req.query.granularity) || 15;
      
      // Validate granularity
      if (granularity < 1 || granularity > 60) {
        return res.status(400).json({ 
          error: 'Granularity must be between 1 and 60 minutes' 
        });
      }
      
      const today = new Date().toISOString().split('T')[0];

      // Get all snapshots for today
      const [snapshots] = await db.pool.query(
        `SELECT 
          timestamp,
          solar_power,
          battery_power,
          battery_soc,
          grid_power,
          load_power
        FROM energy_snapshots
        WHERE DATE(timestamp) = ?
        ORDER BY timestamp ASC`,
        [today]
      );

      if (snapshots.length === 0) {
        return res.json([]);
      }

      // Group by granularity intervals
      const intervalMs = granularity * 60 * 1000;
      const grouped = new Map();

      for (const snapshot of snapshots) {
        const ts = new Date(snapshot.timestamp).getTime();
        const bucketTs = Math.floor(ts / intervalMs) * intervalMs;
        
        if (!grouped.has(bucketTs)) {
          grouped.set(bucketTs, {
            solar_power: [],
            battery_power: [],
            battery_soc: [],
            grid_power: [],
            load_power: []
          });
        }
        
        const bucket = grouped.get(bucketTs);
        bucket.solar_power.push(parseFloat(snapshot.solar_power) || 0);
        bucket.battery_power.push(parseFloat(snapshot.battery_power) || 0);
        bucket.battery_soc.push(parseFloat(snapshot.battery_soc) || 0);
        bucket.grid_power.push(parseFloat(snapshot.grid_power) || 0);
        bucket.load_power.push(parseFloat(snapshot.load_power) || 0);
      }

      // Calculate averages - FLAT structure matching original format
      const result = Array.from(grouped.entries()).map(([bucketTs, values]) => ({
        timestamp: new Date(bucketTs).toISOString(),
        battery_soc: this.avg(values.battery_soc),
        battery_power: this.avg(values.battery_power),
        solar: this.avg(values.solar_power),
        grid: this.avg(values.grid_power),
        home: this.avg(values.load_power)
      }));

      // Return array directly (not wrapped in object)
      res.json(result);

    } catch (error) {
      console.error('Error getting today history:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/history/last-24-hours
   */
  async getLast24Hours(req, res) {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const [snapshots] = await db.pool.query(
        `SELECT 
          timestamp,
          solar_power,
          battery_power,
          battery_soc,
          grid_power,
          load_power
        FROM energy_snapshots
        WHERE timestamp >= ?
        ORDER BY timestamp ASC`,
        [since]
      );

      const data = snapshots.map(s => ({
        timestamp: s.timestamp,
        battery_soc: parseFloat(s.battery_soc) || 0,
        battery_power: parseFloat(s.battery_power) || 0,
        solar: parseFloat(s.solar_power) || 0,
        grid: parseFloat(s.grid_power) || 0,
        home: parseFloat(s.load_power) || 0
      }));

      res.json(data);

    } catch (error) {
      console.error('Error getting last 24 hours:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/history/last-7-days
   */
  async getLast7Days(req, res) {
    try {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const sinceDate = since.toISOString().split('T')[0];

      const [daily] = await db.pool.query(
        `SELECT 
          DATE(timestamp) as date,
          MAX(solar_energy_today) as solar_generation,
          MAX(load_energy_today) as load_consumption,
          MAX(grid_energy_import_today) as grid_import,
          MAX(grid_energy_export_today) as grid_export,
          MAX(battery_charge_today) as battery_charge,
          MAX(battery_discharge_today) as battery_discharge
        FROM energy_snapshots
        WHERE DATE(timestamp) >= ?
        GROUP BY DATE(timestamp)
        ORDER BY date ASC`,
        [sinceDate]
      );

      const data = daily.map(d => ({
        date: d.date,
        solar: parseFloat(d.solar_generation) || 0,
        home: parseFloat(d.load_consumption) || 0,
        grid_import: parseFloat(d.grid_import) || 0,
        grid_export: parseFloat(d.grid_export) || 0,
        battery_charge: parseFloat(d.battery_charge) || 0,
        battery_discharge: parseFloat(d.battery_discharge) || 0
      }));

      res.json(data);

    } catch (error) {
      console.error('Error getting last 7 days:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/history/last-30-days
   */
  async getLast30Days(req, res) {
    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const sinceDate = since.toISOString().split('T')[0];

      const [daily] = await db.pool.query(
        `SELECT 
          DATE(timestamp) as date,
          MAX(solar_energy_today) as solar_generation,
          MAX(load_energy_today) as load_consumption,
          MAX(grid_energy_import_today) as grid_import,
          MAX(grid_energy_export_today) as grid_export
        FROM energy_snapshots
        WHERE DATE(timestamp) >= ?
        GROUP BY DATE(timestamp)
        ORDER BY date ASC`,
        [sinceDate]
      );

      const data = daily.map(d => ({
        date: d.date,
        solar: parseFloat(d.solar_generation) || 0,
        home: parseFloat(d.load_consumption) || 0,
        grid_import: parseFloat(d.grid_import) || 0,
        grid_export: parseFloat(d.grid_export) || 0
      }));

      res.json(data);

    } catch (error) {
      console.error('Error getting last 30 days:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/history/last-365-days
   */
  async getLast365Days(req, res) {
    try {
      const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const sinceDate = since.toISOString().split('T')[0];

      const [daily] = await db.pool.query(
        `SELECT 
          DATE(timestamp) as date,
          MAX(solar_energy_today) as solar_generation,
          MAX(load_energy_today) as load_consumption,
          MAX(grid_energy_import_today) as grid_import,
          MAX(grid_energy_export_today) as grid_export
        FROM energy_snapshots
        WHERE DATE(timestamp) >= ?
        GROUP BY DATE(timestamp)
        ORDER BY date ASC`,
        [sinceDate]
      );

      const data = daily.map(d => ({
        date: d.date,
        solar: parseFloat(d.solar_generation) || 0,
        home: parseFloat(d.load_consumption) || 0,
        grid_import: parseFloat(d.grid_import) || 0,
        grid_export: parseFloat(d.grid_export) || 0
      }));

      res.json(data);

    } catch (error) {
      console.error('Error getting last 365 days:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/history/date/:date (YYYY-MM-DD)
   */
  async getDateData(req, res) {
    try {
      const { date } = req.params;
      
      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ 
          error: 'Invalid date format. Use YYYY-MM-DD' 
        });
      }

      const [snapshots] = await db.pool.query(
        `SELECT 
          timestamp,
          solar_power,
          battery_power,
          battery_soc,
          grid_power,
          load_power
        FROM energy_snapshots
        WHERE DATE(timestamp) = ?
        ORDER BY timestamp ASC`,
        [date]
      );

      const data = snapshots.map(s => ({
        timestamp: s.timestamp,
        battery_soc: parseFloat(s.battery_soc) || 0,
        battery_power: parseFloat(s.battery_power) || 0,
        solar: parseFloat(s.solar_power) || 0,
        grid: parseFloat(s.grid_power) || 0,
        home: parseFloat(s.load_power) || 0
      }));

      res.json(data);

    } catch (error) {
      console.error(`Error getting date ${req.params.date}:`, error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/history/daily
   * Get daily summary for all available days
   */
  async getDailySummary(req, res) {
    try {
      const [daily] = await db.pool.query(
        `SELECT 
          DATE(timestamp) as date,
          MAX(solar_energy_today) as solar_generation,
          MAX(load_energy_today) as load_consumption,
          MAX(grid_energy_import_today) as grid_import,
          MAX(grid_energy_export_today) as grid_export,
          MAX(battery_charge_today) as battery_charge,
          MAX(battery_discharge_today) as battery_discharge
        FROM energy_snapshots
        GROUP BY DATE(timestamp)
        ORDER BY date DESC
        LIMIT 365`
      );

      const data = daily.map(d => ({
        date: d.date,
        solar: parseFloat(d.solar_generation) || 0,
        home: parseFloat(d.load_consumption) || 0,
        grid_import: parseFloat(d.grid_import) || 0,
        grid_export: parseFloat(d.grid_export) || 0,
        battery_charge: parseFloat(d.battery_charge) || 0,
        battery_discharge: parseFloat(d.battery_discharge) || 0
      }));

      res.json(data);

    } catch (error) {
      console.error('Error getting daily summary:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/history/monthly/:year
   */
  async getMonthlySummary(req, res) {
    try {
      const { year } = req.params;
      
      if (!/^\d{4}$/.test(year)) {
        return res.status(400).json({ error: 'Invalid year format' });
      }
      
      // TODO: Implement monthly aggregation
      res.json([]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Helper methods
  avg(arr) {
    if (arr.length === 0) return 0;
    return parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2));
  }
}

export default new HistoryController();