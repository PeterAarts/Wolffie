// server/core/system/controllers/historyController.js
//
// Wijzigingen t.o.v. MySQL-versie:
//   CONVERT_TZ()            →  verwijderd (SQLite slaat lokale tijd op)
//   utcOffset berekening    →  verwijderd
//   daysDiff bugfix         →  / (1000*60*60*1000) → / (1000*60*60*24)
//
// Tijdzone-fix in aggregateSnapshots():
//   new Date(ts).toISOString()  →  _localTimestamp(ts)
//   toISOString() converteert naar UTC — bij CEST (UTC+2) verschuift dit 2u terug.
//   SQLite timestamps zijn lokale tijdstrings ("2026-04-05 21:30:00").
//   Door de string direct te formatteren zonder UTC-conversie klopt de grafiek-as.

import db from '../../database.js';

class HistoryController {

  async getToday(req, res) {
    try {
      const now  = new Date();
      const p    = n => String(n).padStart(2, '0');
      const date = `${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}`;
      return await this.fetchDateData(date, req, res);
    } catch (error) {
      console.error('Error in getToday:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getDateData(req, res) {
    return await this.fetchDateData(req.params.date, req, res);
  }

  async fetchDateData(date, req, res) {
    try {
      const granularity = parseInt(req.query.granularity) || 5;

      const [daily] = await db.pool.query(
        `SELECT
           pv_generation_kwh     AS pv_generation,
           load_consumption_kwh  AS load_consumption,
           grid_import_kwh       AS grid_import,
           grid_export_kwh       AS grid_export,
           battery_charge_kwh    AS battery_charge,
           battery_discharge_kwh AS battery_discharge
         FROM energy_daily WHERE date = ?`,
        [date]
      );

      const [snapshots] = await db.pool.query(
        `SELECT timestamp, solar_power, battery_power, battery_soc, grid_power, load_power
         FROM energy_snapshots
         WHERE date(timestamp) = ?
         ORDER BY timestamp ASC`,
        [date]
      );

      let stats;

      const dailyHasData = daily[0] &&
        (parseFloat(daily[0].pv_generation)    > 0 ||
         parseFloat(daily[0].load_consumption) > 0 ||
         parseFloat(daily[0].grid_import)      > 0 ||
         parseFloat(daily[0].grid_export)      > 0);

      if (dailyHasData) {
        stats = this.formatStats(daily[0]);
      } else if (snapshots.length > 0) {
        const [cumulative] = await db.pool.query(
          `SELECT
             MAX(solar_energy_today)        AS pv_generation,
             MAX(load_energy_today)         AS load_consumption,
             MAX(grid_energy_import_today)  AS grid_import,
             MAX(grid_energy_export_today)  AS grid_export,
             MAX(battery_charge_today)      AS battery_charge,
             MAX(battery_discharge_today)   AS battery_discharge
           FROM energy_snapshots
           WHERE date(timestamp) = ?`,
          [date]
        );
        stats = cumulative[0] ? this.formatStats(cumulative[0]) : this.emptyStats();
      } else {
        stats = this.emptyStats();
      }

      res.json({
        stats,
        data: this.aggregateSnapshots(snapshots, granularity),
      });

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getRange(req, res) {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are mandatory' });
      }

      const start    = new Date(startDate);
      const end      = new Date(endDate);
      const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

      let data;
      let granularity;

      if (daysDiff === 1) {
        granularity = 'minute';
        const [snapshots] = await db.pool.query(
          `SELECT timestamp, solar_power, battery_power, battery_soc, grid_power, load_power
           FROM energy_snapshots
           WHERE date(timestamp) = ?
           ORDER BY timestamp ASC`,
          [startDate]
        );
        data = this.aggregateSnapshots(snapshots, 15);

      } else if (daysDiff <= 31) {
        granularity = 'hour';
        const [hours] = await db.pool.query(
          `SELECT
             timestamp,
             pv_power_avg      AS solar,
             load_power_avg    AS home,
             grid_power_avg    AS grid,
             battery_power_avg AS battery_power,
             battery_soc_avg   AS battery_soc
           FROM energy_hours
           WHERE date(timestamp) BETWEEN ? AND ?
           ORDER BY timestamp ASC`,
          [startDate, endDate]
        );
        data = hours.map(h => ({
          timestamp:     this._localTimestamp(h.timestamp),
          solar:         parseFloat(h.solar)         || 0,
          home:          parseFloat(h.home)          || 0,
          grid:          parseFloat(h.grid)          || 0,
          battery_power: parseFloat(h.battery_power) || 0,
          battery_soc:   parseFloat(h.battery_soc)   || 0,
        }));

      } else {
        granularity = 'day';
        const [days] = await db.pool.query(
          `SELECT
             date                  AS timestamp,
             pv_generation_kwh     AS solar,
             load_consumption_kwh  AS home,
             grid_import_kwh,
             grid_export_kwh,
             battery_charge_kwh,
             battery_discharge_kwh,
             battery_soc_avg       AS battery_soc
           FROM energy_daily
           WHERE date BETWEEN ? AND ?
           ORDER BY date ASC`,
          [startDate, endDate]
        );
        data = days.map(d => ({
          timestamp:     d.timestamp,
          solar:         parseFloat(d.solar)                  || 0,
          home:          parseFloat(d.home)                   || 0,
          grid:          (parseFloat(d.grid_export_kwh)       || 0) - (parseFloat(d.grid_import_kwh)       || 0),
          battery_power: (parseFloat(d.battery_discharge_kwh) || 0) - (parseFloat(d.battery_charge_kwh) || 0),
          battery_soc:   parseFloat(d.battery_soc)            || 0,
        }));
      }

      const [snapshotStats] = await db.pool.query(
        `SELECT
           SUM(daily_pv)        AS pv_generation,
           SUM(daily_load)      AS load_consumption,
           SUM(daily_import)    AS grid_import,
           SUM(daily_export)    AS grid_export,
           SUM(daily_charge)    AS battery_charge,
           SUM(daily_discharge) AS battery_discharge
         FROM (
           SELECT
             date(timestamp)                AS local_date,
             MAX(solar_energy_today)        AS daily_pv,
             MAX(load_energy_today)         AS daily_load,
             MAX(grid_energy_import_today)  AS daily_import,
             MAX(grid_energy_export_today)  AS daily_export,
             MAX(battery_charge_today)      AS daily_charge,
             MAX(battery_discharge_today)   AS daily_discharge
           FROM energy_snapshots
           WHERE date(timestamp) BETWEEN ? AND ?
           GROUP BY local_date
         ) daily_sums`,
        [startDate, endDate]
      );

      const stats = snapshotStats[0]
        ? this.formatStats(snapshotStats[0])
        : this.emptyStats();

      res.json({
        stats,
        data,
        meta: { startDate, endDate, days: daysDiff, granularity, dataPoints: data.length },
      });

    } catch (error) {
      console.error('Error in getRange:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Converteer timestamp naar lokale ISO-string zonder UTC-verschuiving.
  // SQLite geeft "2026-04-05 21:30:00" (lokale tijd).
  // toISOString() zou dit bij CEST -2u verschuiven → 19:30 op de grafiek.
  _localTimestamp(ts) {
    if (typeof ts === 'number') {
      const d = new Date(ts);
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}` +
             `T${p(d.getHours())}:${p(d.getMinutes())}:00`;
    }
    return String(ts).slice(0, 19).replace(' ', 'T');
  }

  aggregateSnapshots(snapshots, granularity) {
    const intervalMs = granularity * 60 * 1000;
    const grouped    = new Map();

    for (const s of snapshots) {
      const tsStr    = String(s.timestamp).slice(0, 19).replace(' ', 'T');
      const bucketTs = Math.floor(new Date(tsStr).getTime() / intervalMs) * intervalMs;

      if (!grouped.has(bucketTs)) {
        grouped.set(bucketTs, { solar: [], battery_p: [], battery_s: [], grid: [], home: [] });
      }
      const b = grouped.get(bucketTs);
      b.solar.push(parseFloat(s.solar_power)     || 0);
      b.battery_p.push(parseFloat(s.battery_power) || 0);
      b.battery_s.push(parseFloat(s.battery_soc)   || 0);
      b.grid.push(parseFloat(s.grid_power)       || 0);
      b.home.push(parseFloat(s.load_power)       || 0);
    }

    return Array.from(grouped.entries()).map(([ts, v]) => ({
      timestamp:     this._localTimestamp(ts),
      solar:         this.avg(v.solar),
      battery_power: this.avg(v.battery_p),
      battery_soc:   this.avg(v.battery_s),
      grid:          this.avg(v.grid),
      home:          this.avg(v.home),
    }));
  }

  avg(arr) {
    return arr.length
      ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2))
      : 0;
  }

  emptyStats() {
    return {
      pv_generation: 0, load_consumption: 0,
      grid_import: 0,   grid_export: 0,
      battery_charge: 0, battery_discharge: 0,
    };
  }

  formatStats(s) {
    return Object.fromEntries(
      Object.entries(s).map(([k, v]) => [k, parseFloat(parseFloat(v).toFixed(2))])
    );
  }
}

export default new HistoryController();