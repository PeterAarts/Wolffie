// modules/solar-forecast/services/collector.js
import api from './api.js';
import db from '../../../core/database.js';
import settingsService from '../../../core/system/services/settingsService.js';

/**
 * Solar Forecast Collector
 *
 * Fetches hourly solar production forecasts from Forecast.Solar and stores them in:
 *   solar_forecast_hourly  – one row per day/hour (hourly_wh delta + cumulative_wh)
 *   solar_forecasts        – one row per day (expected_kwh total, for accuracy tracking)
 */
class SolarForecastCollector {
  constructor() {
    this.name            = 'solar-forecast';
    this.lastError       = null;
    this.lastRun         = null;
    this.lastFetchRecords = 0;
  }

  // ─── Main collection entry point ────────────────────────────────────────────

  async collect() {
    this.lastError = null;
    let recordsCollected = 0;

    try {
      const settings = await settingsService.getCategory('solar-forecast');

      if (!settings || settings.enabled === false) {
        console.log('\x1b[32m   • Solar Forecast: Disabled in settings\x1b[0m');
        return false;
      }

      const {
        latitude,
        longitude,
        tilt,
        azimuth,
        kwp,
        fetch_interval_hours = 15,
        last_fetch           = null,
      } = settings;

      if (!latitude || !longitude || !kwp) {
        this.lastError = 'Missing required settings: latitude, longitude, or kwp';
        console.error('\x1b[91m   • Solar Forecast: Missing required configuration (latitude, longitude, kwp)\x1b[0m');
        return false;
      }

      // Throttle – skip if we fetched recently
      if (last_fetch) {
        const hoursSince = (Date.now() - new Date(last_fetch)) / 3_600_000;
        if (hoursSince < fetch_interval_hours) {
          const nextIn = Math.round((fetch_interval_hours - hoursSince) * 60);
          console.log(`\x1b[37m   • Solar Forecast: Skipping – last fetch ${Math.round(hoursSince * 10) / 10}h ago (next in ~${nextIn} min)\x1b[0m`);
          return true;
        }
      }

      // Fetch from API
      const forecast = await api.getForecast({
        latitude,
        longitude,
        tilt   : tilt    || 35,
        azimuth: azimuth || 180,
        kwp,
      });

      // Store hourly rows (primary new table)
      const hourlyCount = await this.storeHourlyForecast(forecast.hourlyWh);

      // Store / update daily totals in existing solar_forecasts table
      await this.storeDailyForecast(forecast.wattHoursDay);

      // Accuracy housekeeping
      await this.updateActualValues();
      await this.calculateAccuracy();

      this.lastRun         = new Date();
      this.lastFetchRecords = hourlyCount;
      recordsCollected      = hourlyCount;

      await this.updateLastFetchInfo(recordsCollected);

      console.log(`\x1b[37m   • Solar Forecast: Stored ${hourlyCount} hourly slots\x1b[0m`);
      return true;

    } catch (error) {
      this.lastError = error.message;
      console.error('\x1b[91m   • Solar Forecast Error:', error.message, '\x1b[0m');
      return false;
    }
  }

  // ─── Storage ─────────────────────────────────────────────────────────────────

  /**
   * Store per-hour production deltas in solar_forecast_hourly.
   *
   * @param {Record<string, Record<number, number>>} hourlyWh
   *   { "2026-02-22": { 8: 150, 9: 270, ... }, ... }
   */
  async storeHourlyForecast(hourlyWh) {
    if (!hourlyWh || Object.keys(hourlyWh).length === 0) {
      console.warn('\x1b[91m   • Solar Forecast: hourlyWh is empty - check api.js debug logs for actual response shape\x1b[0m');
      return 0;
    }

    let stored = 0;

    for (const [date, hours] of Object.entries(hourlyWh)) {
      const sortedHours = Object.entries(hours)
        .map(([h, wh]) => ({ hour: parseInt(h, 10), hourlyWh: wh }))
        .sort((a, b) => a.hour - b.hour);

      let cumulative = 0;

      for (const { hour, hourlyWh: wh } of sortedHours) {
        cumulative += wh;

        // slot_datetime: "YYYY-MM-DD HH:00:00" in local time
        const slotDatetime = `${date} ${String(hour).padStart(2, '0')}:00:00`;

        await db.pool.query(`
          INSERT INTO solar_forecast_hourly
            (date, slot_datetime, hourly_wh, cumulative_wh, data_source)
          VALUES
            (?, ?, ?, ?, 'forecast.solar')
          ON DUPLICATE KEY UPDATE
            hourly_wh     = VALUES(hourly_wh),
            cumulative_wh = VALUES(cumulative_wh),
            updated_at    = CURRENT_TIMESTAMP
        `, [date, slotDatetime, wh, cumulative]);

        stored++;
      }
    }

    console.log(`\x1b[37m   • Stored ${stored} hourly forecast slots\x1b[0m`);
    return stored;
  }

  /**
   * Store / update daily totals in the existing solar_forecasts table.
   *
   * @param {Record<string, number>} wattHoursDay  { "2026-02-22": 4820, ... }
   */
  async storeDailyForecast(wattHoursDay) {
    if (!wattHoursDay || Object.keys(wattHoursDay).length === 0) return;

    for (const [date, wh] of Object.entries(wattHoursDay)) {
      const expectedKwh = wh / 1000;

      // Use DATE() cast on insert to avoid TIMESTAMP UTC offset issues
      await db.pool.query(`
        INSERT INTO solar_forecasts
          (date, expected_kwh, data_source)
        VALUES
          (CAST(? AS DATE), ?, 'forecast.solar')
        ON DUPLICATE KEY UPDATE
          expected_kwh = VALUES(expected_kwh),
          updated_at   = CURRENT_TIMESTAMP
      `, [date, expectedKwh]);
    }
  }

  // ─── Accuracy housekeeping (unchanged logic) ─────────────────────────────────

  async updateActualValues() {
    try {
      // Try energy_daily first
      try {
        const [tables] = await db.pool.query(`SHOW TABLES LIKE 'energy_daily'`);
        if (tables.length > 0) {
          const [res] = await db.pool.query(`
            UPDATE solar_forecasts sf
            INNER JOIN energy_daily ed ON sf.date = ed.date
            SET sf.actual_kwh = ed.pv_generation_kwh
            WHERE sf.actual_kwh IS NULL
              AND ed.pv_generation_kwh IS NOT NULL
              AND ed.pv_generation_kwh > 0
              AND sf.date < CURDATE()
          `);
          if (res.affectedRows > 0) {
            console.log(`\x1b[37m   • Updated ${res.affectedRows} actual values from energy_daily\x1b[0m`);
            return;
          }
        }
      } catch (_) { /* fall through */ }

      // Fallback: energy_snapshots
      const [dates] = await db.pool.query(`
        SELECT DISTINCT sf.date FROM solar_forecasts sf
        WHERE sf.actual_kwh IS NULL
          AND sf.date < CURDATE()
          AND sf.date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        ORDER BY sf.date DESC
      `);

      let updated = 0;
      for (const { date } of dates) {
        const [prod] = await db.pool.query(`
          SELECT MAX(solar_energy_today) as daily_kwh
          FROM energy_snapshots
          WHERE DATE(timestamp) = ? AND solar_energy_today IS NOT NULL
          HAVING daily_kwh > 0
        `, [date]);

        if (prod.length && prod[0].daily_kwh > 0) {
          await db.pool.query(`
            UPDATE solar_forecasts SET actual_kwh = ?
            WHERE date = ? AND actual_kwh IS NULL
          `, [prod[0].daily_kwh, date]);
          updated++;
        }
      }

      if (updated > 0) console.log(`\x1b[37m   • Updated ${updated} actual values from energy_snapshots\x1b[0m`);
    } catch (e) {
      console.warn('\x1b[91m   • Could not update actual values:', e.message, '\x1b[0m');
    }
  }

  async calculateAccuracy() {
    try {
      const [res] = await db.pool.query(`
        UPDATE solar_forecasts
        SET accuracy_percentage = CASE
          WHEN actual_kwh IS NOT NULL AND expected_kwh > 0
            THEN 100 - ABS((actual_kwh - expected_kwh) / expected_kwh * 100)
          ELSE NULL
        END
        WHERE actual_kwh IS NOT NULL AND accuracy_percentage IS NULL
      `);
      if (res.affectedRows > 0) {
        console.log(`\x1b[37m   • Calculated accuracy for ${res.affectedRows} days\x1b[0m`);
      }
    } catch (e) {
      console.warn('\x1b[37m   • Could not calculate accuracy:', e.message, '\x1b[0m');
    }
  }

  async updateLastFetchInfo(recordsCollected) {
    try {
      const now = new Date().toISOString();
      await db.pool.query(`
        INSERT INTO system_settings (category, setting_key, setting_value, value_type, description)
        VALUES ('solar-forecast', 'last_fetch', ?, 'string', 'Last successful fetch datetime')
        ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()
      `, [now, now]);
      await db.pool.query(`
        INSERT INTO system_settings (category, setting_key, setting_value, value_type, description)
        VALUES ('solar-forecast', 'last_fetch_records', ?, 'number', 'Hourly slots collected in last fetch')
        ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()
      `, [String(recordsCollected), String(recordsCollected)]);
      settingsService.clearCache();
    } catch (e) {
      console.warn('\x1b[91m   • Could not update last fetch info:', e.message, '\x1b[0m');
    }
  }

  // ─── Read methods ────────────────────────────────────────────────────────────

  /**
   * Get full forecast for a specific date: daily total + 24-hour breakdown.
   *
   * Returns:
   * {
   *   date         : "2026-02-22",
   *   expected_kwh : 4.82,
   *   actual_kwh   : null | number,
   *   accuracy_percentage: null | number,
   *   data_source  : "forecast.solar",
   *   hours: [
   *     { hour: 8, hourly_wh: 150, cumulative_wh: 150 },
   *     { hour: 9, hourly_wh: 270, cumulative_wh: 420 },
   *     ...
   *   ]
   * }
   */
  async getForecast(date) {
    // Daily summary row — use DATE() cast because solar_forecasts.date is TIMESTAMP
    // which MariaDB stores as UTC, so direct equality fails for CET dates
    const [daily] = await db.pool.query(`
      SELECT DATE(date) as date, expected_kwh, actual_kwh, accuracy_percentage, data_source
      FROM solar_forecasts
      WHERE DATE(date) = ?
    `, [date]);

    // Hourly breakdown — query by date, return slot_datetime for frontend alignment
    const [hours] = await db.pool.query(`
      SELECT slot_datetime, hourly_wh, cumulative_wh
      FROM solar_forecast_hourly
      WHERE date = ?
      ORDER BY slot_datetime ASC
    `, [date]);

    if (!daily[0] && !hours.length) return null;

    // If we have no daily row yet (e.g. hourly arrived before daily), derive total
    const dailyRow = daily[0] || {
      date,
      expected_kwh       : hours.reduce((s, r) => s + Number(r.hourly_wh), 0) / 1000,
      actual_kwh         : null,
      accuracy_percentage: null,
      data_source        : 'forecast.solar',
    };

    return {
      ...dailyRow,
      expected_kwh: Number(dailyRow.expected_kwh),
      actual_kwh  : dailyRow.actual_kwh != null ? Number(dailyRow.actual_kwh) : null,
      hours       : hours.map(r => ({
        // slot_datetime: "2026-02-27 08:00:00" — local time, matches price datetime format
        slot_datetime: r.slot_datetime instanceof Date
          ? r.slot_datetime.toISOString().replace('T', ' ').substring(0, 19)
          : String(r.slot_datetime).substring(0, 19),
        hourly_wh    : Number(r.hourly_wh),
        cumulative_wh: Number(r.cumulative_wh),
      })),
    };
  }

  /**
   * Get forecast for a date range.
   * Returns array of daily summaries (without per-hour breakdown for brevity).
   * Use getForecast(date) for the full hourly detail on a single day.
   */
  async getForecastRange(startDate, endDate) {
    const [rows] = await db.pool.query(`
      SELECT DATE(date) as date, expected_kwh, actual_kwh, accuracy_percentage, data_source
      FROM solar_forecasts
      WHERE DATE(date) BETWEEN ? AND ?
      ORDER BY date ASC
    `, [startDate, endDate]);

    return rows.map(r => ({
      ...r,
      expected_kwh: Number(r.expected_kwh),
      actual_kwh  : r.actual_kwh != null ? Number(r.actual_kwh) : null,
    }));
  }

  async getAccuracyStats() {
    const [rows] = await db.pool.query(`
      SELECT
        AVG(accuracy_percentage)  as avg_accuracy,
        MIN(accuracy_percentage)  as min_accuracy,
        MAX(accuracy_percentage)  as max_accuracy,
        COUNT(*)                  as total_days,
        COUNT(actual_kwh)         as completed_days,
        SUM(expected_kwh)         as total_expected_kwh,
        SUM(actual_kwh)           as total_actual_kwh
      FROM solar_forecasts
      WHERE accuracy_percentage IS NOT NULL
    `);
    return rows[0] || {
      avg_accuracy: null, min_accuracy: null, max_accuracy: null,
      total_days: 0, completed_days: 0,
      total_expected_kwh: 0, total_actual_kwh: 0,
    };
  }

  async getStatus() {
    let avgAccuracy = null;
    try {
      const stats = await this.getAccuracyStats();
      avgAccuracy = stats.avg_accuracy != null ? Math.round(stats.avg_accuracy * 10) / 10 : null;
    } catch (_) {}

    return {
      name            : this.name,
      lastRun         : this.lastRun,
      lastFetch       : this.lastRun?.toISOString() ?? null,
      lastFetchRecords: this.lastFetchRecords,
      lastError       : this.lastError,
      healthy         : this.lastError === null,
      avgAccuracy,
      apiInfo         : api.getAPIInfo(),
    };
  }

  async testConnection() {
    const health = await api.healthCheck();
    console.log(health.available
      ? '\x1b[37m   • Forecast.Solar API: available\x1b[0m'
      : `\x1b[91m   • Forecast.Solar API: unavailable – ${health.error}\x1b[0m`
    );
    return health;
  }
}

export default new SolarForecastCollector();