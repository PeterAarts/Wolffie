// server/core/system/services/aggregatorService.js
import db from '../../database.js';

class AggregatorService {
  constructor() {
    this.isRunning = false;
    this.aggregationInterval = null;
    this.lastComparisonDate = null;
    this.lastNightlyProfileDate = null;
  }

  start() {
    if (this.isRunning) {
      console.log('   - Aggregator already running');
      return;
    }

    console.log('   - Starting data aggregator...');
    this.isRunning = true;

    this.aggregate();

    this.aggregationInterval = setInterval(async () => {
      await this.aggregate();
    }, 60000);

    console.log('   - Data aggregator started (1 minute interval)');
  }

  stop() {
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
      this.aggregationInterval = null;
    }
    this.isRunning = false;
    console.log('   - Data aggregator stopped');
  }

  async aggregate() {
    try {
      await this.aggregateMinutes();
      await this.aggregateHours();
      await this.aggregateDaily();
      await this.aggregateMonthly();
      await this.aggregateDevices();

      const today = new Date().toISOString().split('T')[0];
      const hour  = new Date().getHours();

      // Forecast accuracy: run once per day, at hour 1 (data from yesterday is settled)
      if (this.lastComparisonDate !== today && hour >= 1) {
        await this.compareForecastWithActual();
        this.lastComparisonDate = today;
      }

      // Nightly profile: run once per day, at hour 2
      if (this.lastNightlyProfileDate !== today && hour >= 2) {
        await this.calculateNightlyProfile();
        this.lastNightlyProfileDate = today;
      }

    } catch (error) {
      console.error('   - Aggregator error:', error.message);
    }
  }

  // ── Minute aggregation ──────────────────────────────────────────────────

  async aggregateMinutes() {
    try {
      const [lastAgg] = await db.pool.query(
        'SELECT MAX(timestamp) as last_time FROM energy_minutes'
      );
      const lastTime = lastAgg[0]?.last_time || new Date(0);

      await db.pool.query(`
        INSERT INTO energy_minutes (
          timestamp,
          battery_soc_avg, battery_soc_min, battery_soc_max,
          battery_power_avg, battery_temperature_avg,
          grid_power_avg, grid_power_min, grid_power_max,
          pv_power_avg, pv_power_max,
          load_power_avg, sample_count
        )
        SELECT 
          DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:00') as minute_timestamp,
          AVG(battery_soc), MIN(battery_soc), MAX(battery_soc),
          AVG(battery_power), AVG(battery_temp),
          AVG(grid_power), MIN(grid_power), MAX(grid_power),
          AVG(solar_power), MAX(solar_power),
          AVG(load_power), COUNT(*)
        FROM energy_snapshots
        WHERE timestamp > ?
        GROUP BY minute_timestamp
        ON DUPLICATE KEY UPDATE
          battery_soc_avg       = VALUES(battery_soc_avg),
          battery_soc_min       = VALUES(battery_soc_min),
          battery_soc_max       = VALUES(battery_soc_max),
          battery_power_avg     = VALUES(battery_power_avg),
          battery_temperature_avg = VALUES(battery_temperature_avg),
          grid_power_avg        = VALUES(grid_power_avg),
          grid_power_min        = VALUES(grid_power_min),
          grid_power_max        = VALUES(grid_power_max),
          pv_power_avg          = VALUES(pv_power_avg),
          pv_power_max          = VALUES(pv_power_max),
          load_power_avg        = VALUES(load_power_avg),
          sample_count          = VALUES(sample_count)
      `, [lastTime]);

      console.log('\x1b[37m   • Aggregator - snapshots → minutes');
    } catch (error) {
      console.error('\x1b[91m   • Aggregator - Minute aggregation failed:', error.message, '\x1b[37m');
    }
  }

  // ── Hour aggregation ────────────────────────────────────────────────────

  async aggregateHours() {
    try {
      const [lastAgg] = await db.pool.query(
        'SELECT MAX(timestamp) as last_time FROM energy_hours'
      );
      const lastTime = lastAgg[0]?.last_time || new Date(0);

      await db.pool.query(`
        INSERT INTO energy_hours (
          timestamp,
          battery_soc_avg, battery_power_avg,
          pv_power_avg, grid_power_avg, load_power_avg
        )
        SELECT 
          DATE_FORMAT(timestamp, '%Y-%m-%d %H:00:00') as hour_timestamp,
          AVG(battery_soc_avg), AVG(battery_power_avg),
          AVG(pv_power_avg), AVG(grid_power_avg), AVG(load_power_avg)
        FROM energy_minutes
        WHERE timestamp > ?
        GROUP BY hour_timestamp
        ON DUPLICATE KEY UPDATE
          battery_soc_avg   = VALUES(battery_soc_avg),
          battery_power_avg = VALUES(battery_power_avg),
          pv_power_avg      = VALUES(pv_power_avg),
          grid_power_avg    = VALUES(grid_power_avg),
          load_power_avg    = VALUES(load_power_avg)
      `, [lastTime]);

      console.log('\x1b[37m   • Aggregator - minutes → hours');
    } catch (error) {
      console.error('\x1b[91m   • Aggregator - Hour aggregation failed:', error.message, '\x1b[37m');
    }
  }

  // ── Daily aggregation ───────────────────────────────────────────────────

  async aggregateDaily() {
    try {
      const [lastAgg] = await db.pool.query(
        'SELECT MAX(date) as last_date FROM energy_daily'
      );
      const lastDate = lastAgg[0]?.last_date || '1970-01-01';

      await db.pool.query(`
        INSERT INTO energy_daily (
          date,
          pv_generation_kwh, load_consumption_kwh,
          grid_import_kwh, grid_export_kwh,
          battery_charge_kwh, battery_discharge_kwh
        )
        SELECT 
          DATE(timestamp) as day,
          MAX(solar_energy_today),
          MAX(load_energy_today),
          MAX(grid_energy_import_today),
          MAX(grid_energy_export_today),
          MAX(battery_charge_today),
          MAX(battery_discharge_today)
        FROM energy_snapshots
        WHERE DATE(timestamp) > ?
        GROUP BY day
        ON DUPLICATE KEY UPDATE
          pv_generation_kwh    = VALUES(pv_generation_kwh),
          load_consumption_kwh = VALUES(load_consumption_kwh),
          grid_import_kwh      = VALUES(grid_import_kwh),
          grid_export_kwh      = VALUES(grid_export_kwh),
          battery_charge_kwh   = VALUES(battery_charge_kwh),
          battery_discharge_kwh = VALUES(battery_discharge_kwh)
      `, [lastDate]);

      console.log('\x1b[37m   • Aggregator - snapshots → daily');
    } catch (error) {
      console.error('\x1b[37m   • Aggregator - Daily aggregation failed:', error.message, '\x1b[91m');
    }
  }

  // ── Monthly aggregation ─────────────────────────────────────────────────

  async aggregateMonthly() {
    try {
      const [lastAgg] = await db.pool.query(
        'SELECT MAX(CONCAT(year, "-", LPAD(month, 2, "0"))) as last_month FROM energy_monthly'
      );
      const lastMonth = lastAgg[0]?.last_month || '1970-01';

      await db.pool.query(`
        INSERT INTO energy_monthly (
          year, month,
          pv_generation_kwh, load_consumption_kwh,
          grid_import_kwh, grid_export_kwh,
          battery_charge_kwh, battery_discharge_kwh
        )
        SELECT 
          YEAR(date), MONTH(date),
          SUM(pv_generation_kwh), SUM(load_consumption_kwh),
          SUM(grid_import_kwh), SUM(grid_export_kwh),
          SUM(battery_charge_kwh), SUM(battery_discharge_kwh)
        FROM energy_daily
        WHERE DATE_FORMAT(date, '%Y-%m') > ?
        GROUP BY YEAR(date), MONTH(date)
        ON DUPLICATE KEY UPDATE
          pv_generation_kwh    = VALUES(pv_generation_kwh),
          load_consumption_kwh = VALUES(load_consumption_kwh),
          grid_import_kwh      = VALUES(grid_import_kwh),
          grid_export_kwh      = VALUES(grid_export_kwh),
          battery_charge_kwh   = VALUES(battery_charge_kwh),
          battery_discharge_kwh = VALUES(battery_discharge_kwh)
      `, [lastMonth]);

      console.log('\x1b[37m   • Aggregator - daily → monthly');
    } catch (error) {
      console.error('\x1b[91m   • Aggregator - Monthly aggregation failed:', error.message, '\x1b[37m');
    }
  }

  // ── Device aggregation ──────────────────────────────────────────────────

  async aggregateDevices() {
    try {
      await db.pool.query(`
        INSERT INTO device_daily_usage (device_id, date, usage_kwh, last_update)
        SELECT 
          device_id,
          CURDATE(),
          (
            SUBSTRING_INDEX(MAX(CONCAT(timestamp, '|', energy_total)), '|', -1) - 
            SUBSTRING_INDEX(MIN(CONCAT(timestamp, '|', energy_total)), '|', -1)
          ),
          MAX(timestamp)
        FROM device_measurements
        WHERE timestamp >= CURDATE()
        GROUP BY device_id
        ON DUPLICATE KEY UPDATE 
          usage_kwh   = VALUES(usage_kwh),
          last_update = VALUES(last_update)
      `);

      console.log('\x1b[37m   • Aggregator - device measurements → daily usage');
    } catch (error) {
      console.error('\x1b[91m   • Aggregator - Device aggregation failed:', error.message, '\x1b[37m');
    }
  }

  // ── Forecast accuracy ───────────────────────────────────────────────────
  //
  // FIX: Previous version used (actual_kwh / expected_kwh) in the SET clause,
  // referencing the column being updated in the same statement. MySQL evaluates
  // SET using the old row values, so actual_kwh was still NULL when
  // accuracy_percentage was computed. Fixed by passing the computed value
  // as a parameter instead.

  async compareForecastWithActual() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    try {
      const [daily] = await db.pool.query(
        'SELECT pv_generation_kwh FROM energy_daily WHERE date = ?',
        [dateStr]
      );

      if (!daily[0]) {
        console.log(`\x1b[37m   • SolarForecast - No energy_daily row for ${dateStr}, skipping accuracy update`);
        return;
      }

      const actualKwh = parseFloat(daily[0].pv_generation_kwh) || 0;

      // Fetch expected so we can compute accuracy as a JS value (avoids the
      // MySQL self-reference bug where actual_kwh is still NULL in the same SET)
      const [forecast] = await db.pool.query(
        'SELECT expected_kwh FROM solar_forecasts WHERE date = ?',
        [dateStr]
      );

      if (!forecast[0]) {
        console.log(`\x1b[37m   • SolarForecast - No forecast row for ${dateStr}, skipping`);
        return;
      }

      const expectedKwh      = parseFloat(forecast[0].expected_kwh) || 0;
      const accuracyPct      = expectedKwh > 0
        ? Math.round((actualKwh / expectedKwh) * 100 * 10) / 10  // 1 decimal
        : 0;

      await db.pool.query(
        `UPDATE solar_forecasts
            SET actual_kwh         = ?,
                accuracy_percentage = ?
          WHERE date = ?`,
        [actualKwh, accuracyPct, dateStr]
      );

      console.log(`\x1b[37m   • SolarForecast - Accuracy for ${dateStr}: ${actualKwh} kWh actual / ${expectedKwh} kWh forecast = ${accuracyPct}%`);

    } catch (error) {
      console.error('\x1b[91m   • SolarForecast - comparison failed:', error.message, '\x1b[37m');
    }
  }

  // ── Nightly profile calculation ─────────────────────────────────────────
  //
  // Runs once at 02:00 each day. Queries energy_hours for the last 14 days
  // to build an average hourly load profile, determines how much energy is
  // needed from midnight until solar meaningfully starts, and writes the
  // result into strategy_config for smart-eco so decide() can use it.
  //
  // Written profile shape (stored as JSON in strategy_config.config):
  // {
  //   calculatedAt:        ISO string,
  //   dailyAvgLoadKwh:     number,   -- avg total daily consumption (14d)
  //   morningKwhNeeded:    number,   -- avg load from 00:00 to solar_start_hour
  //   solarStartHour:      number,   -- first hour tomorrow with > 200W forecast
  //   solarTotalKwh:       number,   -- total forecast kWh for tomorrow
  //   forecastAccuracyFactor: number,-- avg(accuracy/100) over last 14 days with data
  //   hourlyLoadProfile:   number[], -- 24-element array, avg load_power_avg in W
  // }

  async calculateNightlyProfile() {
    console.log('   • NightlyProfile - Calculating morning energy profile...');

    try {
      // ── 1. Average hourly load profile over last 14 days ─────────────────
      // energy_hours.load_power_avg is in watts (average power over that hour)
      // Convert to kWh: watts × 1h / 1000

      const [hourlyRows] = await db.pool.query(`
        SELECT 
          HOUR(timestamp)          AS hour_of_day,
          AVG(load_power_avg)      AS avg_load_w,
          COUNT(*)                 AS sample_count
        FROM energy_hours
        WHERE timestamp >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
          AND timestamp <  CURDATE()          -- exclude today (incomplete)
          AND load_power_avg IS NOT NULL
          AND load_power_avg > 0
        GROUP BY hour_of_day
        ORDER BY hour_of_day
      `);

      // Build a 24-element array. Hours with no data get 0.
      const hourlyLoadProfile = Array(24).fill(0);
      for (const row of hourlyRows) {
        hourlyLoadProfile[row.hour_of_day] = Math.round(row.avg_load_w);
      }

      // ── 2. Daily average load (14 days) ───────────────────────────────────
      const [dailyRows] = await db.pool.query(`
        SELECT AVG(load_consumption_kwh) AS avg_load_kwh
        FROM energy_daily
        WHERE date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
          AND date <  CURDATE()
          AND load_consumption_kwh > 0
      `);
      const dailyAvgLoadKwh = parseFloat(dailyRows[0]?.avg_load_kwh) || 5.0;

      // ── 3. Tomorrow's solar forecast ──────────────────────────────────────
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      const [forecastRows] = await db.pool.query(`
        SELECT HOUR(slot_datetime) AS hour_of_day,
               hourly_wh
        FROM solar_forecast_hourly
        WHERE date = ?
        ORDER BY hour_of_day
      `, [tomorrowStr]);

      // First hour where forecast exceeds 200 Wh (meaningful solar start)
      const SOLAR_START_THRESHOLD_WH = 200;
      let solarStartHour = 9; // safe default
      let solarTotalKwh  = 0;

      for (const row of forecastRows) {
        solarTotalKwh += (row.hourly_wh / 1000);
        if (row.hourly_wh >= SOLAR_START_THRESHOLD_WH && row.hour_of_day < solarStartHour) {
          solarStartHour = row.hour_of_day;
        }
      }

      // If no tomorrow forecast yet, fall back to today's
      if (forecastRows.length === 0) {
        const todayStr = new Date().toISOString().split('T')[0];
        const [todayForecast] = await db.pool.query(
          'SELECT expected_kwh FROM solar_forecasts WHERE date = ?',
          [todayStr]
        );
        solarTotalKwh = parseFloat(todayForecast[0]?.expected_kwh) || 0;
      }

      // ── 4. Morning kWh needed (midnight → solar_start_hour) ───────────────
      // Sum the average load for each hour from 00:00 up to (not including)
      // solar_start_hour. Power in W × 1h / 1000 = kWh per hour slot.
      let morningKwhNeeded = 0;
      for (let h = 0; h < solarStartHour; h++) {
        morningKwhNeeded += hourlyLoadProfile[h] / 1000;
      }
      morningKwhNeeded = Math.round(morningKwhNeeded * 100) / 100;

      // ── 5. Forecast accuracy factor (last 14 days with actual data) ────────
      const [accuracyRows] = await db.pool.query(`
        SELECT AVG(accuracy_percentage) AS avg_accuracy
        FROM solar_forecasts
        WHERE date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
          AND date <  CURDATE()
          AND actual_kwh  IS NOT NULL
          AND actual_kwh   > 0
          AND expected_kwh > 0
      `);
      // accuracy_percentage is 0–100+, convert to factor 0.0–1.0
      // Cap at 1.0 (don't over-trust a forecast that exceeded actual)
      const rawAccuracy = parseFloat(accuracyRows[0]?.avg_accuracy);
      const forecastAccuracyFactor = isNaN(rawAccuracy)
        ? 0.7                                       // conservative default if no history
        : Math.min(1.0, rawAccuracy / 100);

      // ── 6. Write profile to strategy_config ───────────────────────────────
      const profile = {
        calculatedAt:           new Date().toISOString(),
        dailyAvgLoadKwh:        Math.round(dailyAvgLoadKwh * 100) / 100,
        morningKwhNeeded,
        solarStartHour,
        solarTotalKwh:          Math.round(solarTotalKwh * 100) / 100,
        forecastAccuracyFactor: Math.round(forecastAccuracyFactor * 1000) / 1000,
        hourlyLoadProfile,
      };

      await db.pool.query(`
        INSERT INTO strategy_config (strategy_id, config)
        VALUES ('smart-eco', ?)
        ON DUPLICATE KEY UPDATE config = JSON_MERGE_PATCH(config, ?)
      `, [JSON.stringify({ nightlyProfile: profile }), JSON.stringify({ nightlyProfile: profile })]);

      console.log(
        `\x1b[37m   • NightlyProfile - Done: morning=${morningKwhNeeded} kWh, ` +
        `solarStart=h${solarStartHour}, solarForecast=${solarTotalKwh} kWh, ` +
        `accuracy=${Math.round(forecastAccuracyFactor * 100)}%`
      );

    } catch (error) {
      console.error('\x1b[91m   • NightlyProfile - Failed:', error.message, '\x1b[37m');
    }
  }
}

export default new AggregatorService();