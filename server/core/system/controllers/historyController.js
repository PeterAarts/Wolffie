// server/controllers/historyController.js
import db from '../../database.js';

class HistoryController {
  /**
   * GET /api/history/today?granularity=15
   */
  async getToday(req, res) {
    try {
      const date = new Date().toISOString().split('T')[0];
      // Hergebruik de getDateData logica voor consistentie
      return await this.fetchDateData(date, req, res);
    } catch (error) {
      console.error('Error in getToday:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/history/date/:date?granularity=15
   */
  async getDateData(req, res) {
    return await this.fetchDateData(req.params.date, req, res);
  }

  /**
   * Interne helper voor dag-data (gebruikt door getToday en getDateData)
   */
  async fetchDateData(date, req, res) {
    try {
      const granularity = parseInt(req.query.granularity) || 5;

      // 1. Haal stats op uit de snelle daily tabel
      const [daily] = await db.pool.query(
        `SELECT 
          pv_generation_kwh as pv_generation,
          load_consumption_kwh as load_consumption,
          grid_import_kwh as grid_import,
          grid_export_kwh as grid_export,
          battery_charge_kwh as battery_charge,
          battery_discharge_kwh as battery_discharge
        FROM energy_daily WHERE date = ?`, [date]
      );

      // 2. Haal gedetailleerde snapshots op voor de grafiek
      const [snapshots] = await db.pool.query(
        `SELECT timestamp, solar_power, battery_power, battery_soc, grid_power, load_power 
         FROM energy_snapshots WHERE DATE(timestamp) = ? ORDER BY timestamp ASC`, [date]
      );

      res.json({
        stats: daily[0] ? this.formatStats(daily[0]) : this.emptyStats(),
        data: this.aggregateSnapshots(snapshots, granularity)
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GENERIEK: Voor periodes (meerdere dagen)
   * GET /api/history/range?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
   */
async getRange(req, res) {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are mandatory' });
    }

    // Bereken aantal dagen
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 1000)) + 1;

    let data;
    let granularity;
    
    if (daysDiff === 1) {
      // Voor 1 dag: gebruik snapshots met 15-min aggregatie
      granularity = 'minute';
      const [snapshots] = await db.pool.query(
        `SELECT timestamp, solar_power, battery_power, battery_soc, grid_power, load_power 
         FROM energy_snapshots WHERE DATE(timestamp) = ? ORDER BY timestamp ASC`,
        [startDate]
      );
      data = this.aggregateSnapshots(snapshots, 15);
      
    } else if (daysDiff <= 31) {
      // Voor 2-31 dagen: gebruik hourly data (energy_hours tabel)
      granularity = 'hour';
      const [hours] = await db.pool.query(
        `SELECT 
          timestamp,
          pv_power_avg as solar,
          load_power_avg as home,
          grid_power_avg as grid,
          battery_power_avg as battery_power,
          battery_soc_avg as battery_soc
        FROM energy_hours
        WHERE DATE(timestamp) BETWEEN ? AND ?
        ORDER BY timestamp ASC`,
        [startDate, endDate]
      );
      
      data = hours.map(h => ({
        timestamp: h.timestamp,
        solar: parseFloat(h.solar) || 0,
        home: parseFloat(h.home) || 0,
        grid: parseFloat(h.grid) || 0,
        battery_power: parseFloat(h.battery_power) || 0,
        battery_soc: parseFloat(h.battery_soc) || 0
      }));
      
    } else {
      // Voor >31 dagen: gebruik daily data (energy_daily tabel)
      granularity = 'day';
      const [days] = await db.pool.query(
        `SELECT 
          date as timestamp,
          pv_generation_kwh as solar,
          load_consumption_kwh as home,
          grid_import_kwh,
          grid_export_kwh,
          battery_charge_kwh,
          battery_discharge_kwh,
          battery_soc_avg as battery_soc
        FROM energy_daily
        WHERE date BETWEEN ? AND ?
        ORDER BY date ASC`,
        [startDate, endDate]
      );
      
      data = days.map(d => ({
        timestamp: d.timestamp,
        solar: parseFloat(d.solar) || 0,
        home: parseFloat(d.home) || 0,
        // Grid: net flow (export - import)
        grid: (parseFloat(d.grid_export_kwh) || 0) - (parseFloat(d.grid_import_kwh) || 0),
        // Battery: net flow (discharge - charge)
        battery_power: (parseFloat(d.battery_discharge_kwh) || 0) - (parseFloat(d.battery_charge_kwh) || 0),
        battery_soc: parseFloat(d.battery_soc) || 0
      }));
    }

    // Bereken totalen voor stats
    const [dailyStats] = await db.pool.query(
      `SELECT 
        SUM(pv_generation_kwh) as pv_generation,
        SUM(load_consumption_kwh) as load_consumption,
        SUM(grid_import_kwh) as grid_import,
        SUM(grid_export_kwh) as grid_export,
        SUM(battery_charge_kwh) as battery_charge,
        SUM(battery_discharge_kwh) as battery_discharge
      FROM energy_daily
      WHERE date BETWEEN ? AND ?`,
      [startDate, endDate]
    );

    const stats = dailyStats[0] ? this.formatStats(dailyStats[0]) : this.emptyStats();

    res.json({
      stats,
      data,
      meta: {
        startDate,
        endDate,
        days: daysDiff,
        granularity: granularity,
        dataPoints: data.length
      }
    });
    
  } catch (error) {
    console.error('Error in getRange:', error);
    res.status(500).json({ error: error.message });
  }
}

  // --- HELPER FUNCTIES ---

  aggregateSnapshots(snapshots, granularity) {
    const intervalMs = granularity * 60 * 1000;
    const grouped = new Map();

    for (const s of snapshots) {
      const bucketTs = Math.floor(new Date(s.timestamp).getTime() / intervalMs) * intervalMs;
      if (!grouped.has(bucketTs)) {
        grouped.set(bucketTs, { solar: [], battery_p: [], battery_s: [], grid: [], home: [] });
      }
      const b = grouped.get(bucketTs);
      b.solar.push(parseFloat(s.solar_power) || 0);
      b.battery_p.push(parseFloat(s.battery_power) || 0);
      b.battery_s.push(parseFloat(s.battery_soc) || 0);
      b.grid.push(parseFloat(s.grid_power) || 0);
      b.home.push(parseFloat(s.load_power) || 0);
    }

    return Array.from(grouped.entries()).map(([ts, v]) => ({
      timestamp: new Date(ts).toISOString(),
      solar: this.avg(v.solar),
      battery_power: this.avg(v.battery_p),
      battery_soc: this.avg(v.battery_s),
      grid: this.avg(v.grid),
      home: this.avg(v.home)
    }));
  }

  avg(arr) {
    return arr.length ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : 0;
  }

  emptyStats() {
    return { pv_generation: 0, load_consumption: 0, grid_import: 0, grid_export: 0, battery_charge: 0, battery_discharge: 0 };
  }

  formatStats(s) {
    return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, parseFloat(parseFloat(v).toFixed(2))]));
  }
}

export default new HistoryController();