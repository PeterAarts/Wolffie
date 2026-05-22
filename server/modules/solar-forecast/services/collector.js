// modules/solar-forecast/services/collector.js
import db   from '../../../core/database.js';
import api  from './api.js';
import { localTimestamp } from '../../../core/utils/localTimestamp.js';
import { padName } from '../../../core/utils/logger.js';
const PREFIX = padName('Solar Forecast');

class SolarForecastCollector {
  constructor() {
    this.config    = null;
    this.lastRun   = null;
    this.lastError = null;
    this.healthy   = true;
  }

  // ── Collect ────────────────────────────────────────────────────────────────

  async collect() {
    if (!this.config) return false;
    if (this.config.enabled === false || this.config.enabled === 'false') return false;

    const { latitude, longitude, tilt = 35, azimuth = 180, kwp } = this.config;
    if (!latitude || !longitude || !kwp) {
      console.warn(`   • ${PREFIX} missing required config (lat/lon/kwp)`);
      return false;
    }

    try {
      const forecast = await api.getForecast({ latitude, longitude, tilt, azimuth, kwp });
      await this._storeForecast(forecast);

      this.lastRun   = new Date();
      this.lastError = null;
      this.healthy   = true;
      return true;

    } catch (error) {
      this.lastError = error.message;
      this.healthy   = false;
      console.error(`\x1b[31m   • ${PREFIX} Error: ${error.message}\x1b[37m`);
      return false;
    }
  }

  // ── Store ──────────────────────────────────────────────────────────────────

  async _storeForecast({ wattHoursDay, hourlyWh }) {
    // updated_at columns use local time (CET/CEST without offset marker) to
    // stay consistent with the rest of the system. SQLite's datetime('now')
    // returns UTC by default, which would shift updated_at relative to the
    // forecast's local-time slot_datetime values.
    const now = localTimestamp();

    // 1. Upsert daily totals into solar_forecasts
    for (const [date, totalWh] of Object.entries(wattHoursDay)) {
      const expectedKwh = Math.round(totalWh) / 1000;
      await db.pool.query(
        `INSERT INTO solar_forecasts (date, expected_kwh, data_source)
         VALUES (?, ?, 'forecast.solar')
         ON CONFLICT(date) DO UPDATE SET
           expected_kwh = excluded.expected_kwh,
           updated_at   = ?`,
        [date, expectedKwh, now]
      );
    }

    // 2. Upsert hourly slots into solar_forecast_hourly
    //    hourlyWh shape: { "YYYY-MM-DD": { 8: 150, 9: 270, ... } }
    for (const [date, hours] of Object.entries(hourlyWh)) {
      const sortedHours = Object.keys(hours).map(Number).sort((a, b) => a - b);
      let cumulative = 0;

      for (const hour of sortedHours) {
        const hourlyWhVal = hours[hour];
        cumulative += hourlyWhVal;

        const pad          = n => String(n).padStart(2, '0');
        const slotDatetime = `${date} ${pad(hour)}:00:00`;

        await db.pool.query(
          `INSERT INTO solar_forecast_hourly (date, slot_datetime, hourly_wh, cumulative_wh, data_source)
           VALUES (?, ?, ?, ?, 'forecast.solar')
           ON CONFLICT(slot_datetime) DO UPDATE SET
             hourly_wh     = excluded.hourly_wh,
             cumulative_wh = excluded.cumulative_wh,
             updated_at    = ?`,
          [date, slotDatetime, hourlyWhVal, cumulative, now]
        );
      }
    }

    const days  = Object.keys(wattHoursDay).length;
    const slots = Object.values(hourlyWh).reduce((sum, h) => sum + Object.keys(h).length, 0);
    console.log(`   • ${PREFIX} - stored ${days} day(s), ${slots} hourly slot(s)`);
  }

  // ── Query helpers (used by routes) ────────────────────────────────────────

  async getForecast(date) {
    const [summaryRows] = await db.pool.query(
      `SELECT date, expected_kwh, actual_kwh, accuracy_percentage, data_source, updated_at
       FROM solar_forecasts WHERE date = ?`,
      [date]
    );
    if (!summaryRows.length) return null;

    const [hourlyRows] = await db.pool.query(
      `SELECT slot_datetime, hourly_wh, cumulative_wh
       FROM solar_forecast_hourly WHERE date = ?
       ORDER BY slot_datetime ASC`,
      [date]
    );

    return {
      ...summaryRows[0],
      hourly: hourlyRows.map(r => ({
        slot_datetime: r.slot_datetime,
        hour:          parseInt(r.slot_datetime.slice(11, 13), 10),
        hourly_wh:     r.hourly_wh,
        cumulative_wh: r.cumulative_wh,
      })),
    };
  }

  async getForecastRange(startDate, endDate) {
    const [rows] = await db.pool.query(
      `SELECT date, expected_kwh, actual_kwh, accuracy_percentage, updated_at
       FROM solar_forecasts
       WHERE date BETWEEN ? AND ?
       ORDER BY date ASC`,
      [startDate, endDate]
    );
    return rows;
  }

  async getAccuracyStats() {
    const [rows] = await db.pool.query(
      `SELECT date, expected_kwh, actual_kwh, accuracy_percentage
       FROM solar_forecasts
       WHERE actual_kwh IS NOT NULL
       ORDER BY date DESC
       LIMIT 30`
    );
    const avg = rows.length
      ? rows.reduce((s, r) => s + (r.accuracy_percentage ?? 0), 0) / rows.length
      : null;
    return {
      records:         rows,
      averageAccuracy: avg !== null ? Math.round(avg * 10) / 10 : null,
    };
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  getStatus() {
    return {
      lastRun:   this.lastRun,
      lastError: this.lastError,
      healthy:   this.healthy,
    };
  }
}

export default new SolarForecastCollector();