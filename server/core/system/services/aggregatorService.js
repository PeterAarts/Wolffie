// server/core/system/services/aggregatorService.js
// Simplified: Use AlphaESS's own daily totals instead of calculating from power

import db from '../../database.js';

class AggregatorService {
  constructor() {
    this.isRunning = false;
    this.aggregationInterval = null;
    this.lastComparisonDate = null;
  }

  start() {
    if (this.isRunning) {
      console.log('   - Aggregator already running');
      return;
    }

    console.log('   - Starting data aggregator...');
    this.isRunning = true;

    // Aggregate immediately
    this.aggregate();

    // Then aggregate every minute
    this.aggregationInterval = setInterval(async () => {
      await this.aggregate();
    }, 60000); // 1 minute

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
      // aggregate in sequence - minutes → hours → daily → monthly for the inverter data
      await this.aggregateMinutes();
      await this.aggregateHours();
      await this.aggregateDaily();
      await this.aggregateMonthly();
      // Then update the device's aggregated values for quick access
      await this.aggregateDevices();
      // Daily forecast comparison
      const today = new Date().toISOString().split('T')[0];
      const hour = new Date().getHours();

      if (this.lastComparisonDate !== today && hour >= 1) {
        await this.compareForecastWithActual();
        this.lastComparisonDate = today;
      }
    } catch (error) {
      console.error('   - Aggregator error:', error.message);
    }
  }

  /**
   * Aggregate snapshots into 1-minute averages
   * Uses simple power averages and min/max tracking
   */
  async aggregateMinutes() {
    try {
      const [lastAgg] = await db.pool.query(
        'SELECT MAX(timestamp) as last_time FROM energy_minutes'
      );

      const lastTime = lastAgg[0]?.last_time || new Date(0);

      await db.pool.query(`
        INSERT INTO energy_minutes (
          timestamp,
          battery_soc_avg,
          battery_soc_min,
          battery_soc_max,
          battery_power_avg,
          battery_temperature_avg,
          grid_power_avg,
          grid_power_min,
          grid_power_max,
          pv_power_avg,
          pv_power_max,
          load_power_avg,
          sample_count
        )
        SELECT 
          DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:00') as minute_timestamp,
          AVG(battery_soc) as battery_soc_avg,
          MIN(battery_soc) as battery_soc_min,
          MAX(battery_soc) as battery_soc_max,
          AVG(battery_power) as battery_power_avg,
          AVG(battery_temp) as battery_temperature_avg,
          AVG(grid_power) as grid_power_avg,
          MIN(grid_power) as grid_power_min,
          MAX(grid_power) as grid_power_max,
          AVG(solar_power) as pv_power_avg,
          MAX(solar_power) as pv_power_max,
          AVG(load_power) as load_power_avg,
          COUNT(*) as sample_count
        FROM energy_snapshots
        WHERE timestamp > ?
        GROUP BY minute_timestamp
        ON DUPLICATE KEY UPDATE
          battery_soc_avg = VALUES(battery_soc_avg),
          battery_soc_min = VALUES(battery_soc_min),
          battery_soc_max = VALUES(battery_soc_max),
          battery_power_avg = VALUES(battery_power_avg),
          battery_temperature_avg = VALUES(battery_temperature_avg),
          grid_power_avg = VALUES(grid_power_avg),
          grid_power_min = VALUES(grid_power_min),
          grid_power_max = VALUES(grid_power_max),
          pv_power_avg = VALUES(pv_power_avg),
          pv_power_max = VALUES(pv_power_max),
          load_power_avg = VALUES(load_power_avg),
          sample_count = VALUES(sample_count)
      `, [lastTime]);

      console.log('\x1b[37m   • Aggregator - snapshots → minutes');
    } catch (error) {
      console.error('\x1b[91m   • Aggregator - Minute aggregation failed:', error.message,'\x1b[37m');
    }
  }

  /**
   * Aggregate minutes into hourly data
   * Only averages power - energy comes directly from daily aggregation
   */
  async aggregateHours() {
    try {
      const [lastAgg] = await db.pool.query(
        'SELECT MAX(timestamp) as last_time FROM energy_hours'
      );

      const lastTime = lastAgg[0]?.last_time || new Date(0);

      // Just track power averages - daily gets energy directly from snapshots
      await db.pool.query(`
        INSERT INTO energy_hours (
          timestamp,
          battery_soc_avg,
          battery_power_avg,
          pv_power_avg,
          grid_power_avg,
          load_power_avg
        )
        SELECT 
          DATE_FORMAT(timestamp, '%Y-%m-%d %H:00:00') as hour_timestamp,
          AVG(battery_soc_avg) as battery_soc_avg,
          AVG(battery_power_avg) as battery_power_avg,
          AVG(pv_power_avg) as pv_power_avg,
          AVG(grid_power_avg) as grid_power_avg,
          AVG(load_power_avg) as load_power_avg
        FROM energy_minutes
        WHERE timestamp > ?
        GROUP BY hour_timestamp
        ON DUPLICATE KEY UPDATE
          battery_soc_avg = VALUES(battery_soc_avg),
          battery_power_avg = VALUES(battery_power_avg),
          pv_power_avg = VALUES(pv_power_avg),
          grid_power_avg = VALUES(grid_power_avg),
          load_power_avg = VALUES(load_power_avg)
      `, [lastTime]);

      console.log('\x1b[37m   • Aggregator - minutes → hours (power only)');
    } catch (error) {
      console.error('\x1b[91m   • Aggregator - Hour aggregation failed:', error.message,'\x1b[37m');
      // Don't throw - daily aggregation can still work
    }
  }

  /**
   * SIMPLIFIED: Get daily totals directly from the last snapshot of each day
   * Uses AlphaESS's own daily cumulative counters
   */
  async aggregateDaily() {
    try {
      const [lastAgg] = await db.pool.query(
        'SELECT MAX(date) as last_date FROM energy_daily'
      );

      const lastDate = lastAgg[0]?.last_date || '1970-01-01';

      // Get the LAST snapshot of each day (highest timestamp = final cumulative values)
      await db.pool.query(`
        INSERT INTO energy_daily (
          date,
          pv_generation_kwh,
          load_consumption_kwh,
          grid_import_kwh,
          grid_export_kwh,
          battery_charge_kwh,
          battery_discharge_kwh
        )
        SELECT 
          DATE(timestamp) as day,
          MAX(solar_energy_today) as pv_generation_kwh,
          MAX(load_energy_today) as load_consumption_kwh,
          MAX(grid_energy_import_today) as grid_import_kwh,
          MAX(grid_energy_export_today) as grid_export_kwh,
          MAX(battery_charge_today) as battery_charge_kwh,
          MAX(battery_discharge_today) as battery_discharge_kwh
        FROM energy_snapshots
        WHERE DATE(timestamp) > ?
        GROUP BY day
        ON DUPLICATE KEY UPDATE
          pv_generation_kwh = VALUES(pv_generation_kwh),
          load_consumption_kwh = VALUES(load_consumption_kwh),
          grid_import_kwh = VALUES(grid_import_kwh),
          grid_export_kwh = VALUES(grid_export_kwh),
          battery_charge_kwh = VALUES(battery_charge_kwh),
          battery_discharge_kwh = VALUES(battery_discharge_kwh)
      `, [lastDate]);

      console.log('\x1b[37m   • Aggregator - snapshots → daily (using inverter totals)');
    } catch (error) {
      console.error('\x1b[37m   • Aggregator - Daily aggregation failed:', error.message,'\x1b[91m');
    }
  }

  /**
   * Sum daily to monthly
   */
  async aggregateMonthly() {
    try {
      const [lastAgg] = await db.pool.query(
        'SELECT MAX(CONCAT(year, "-", LPAD(month, 2, "0"))) as last_month FROM energy_monthly'
      );

      const lastMonth = lastAgg[0]?.last_month || '1970-01';

      await db.pool.query(`
        INSERT INTO energy_monthly (
          year,
          month,
          pv_generation_kwh,
          load_consumption_kwh,
          grid_import_kwh,
          grid_export_kwh,
          battery_charge_kwh,
          battery_discharge_kwh
        )
        SELECT 
          YEAR(date) as year,
          MONTH(date) as month,
          SUM(pv_generation_kwh) as pv_generation_kwh,
          SUM(load_consumption_kwh) as load_consumption_kwh,
          SUM(grid_import_kwh) as grid_import_kwh,
          SUM(grid_export_kwh) as grid_export_kwh,
          SUM(battery_charge_kwh) as battery_charge_kwh,
          SUM(battery_discharge_kwh) as battery_discharge_kwh
        FROM energy_daily
        WHERE DATE_FORMAT(date, '%Y-%m') > ?
        GROUP BY year, month
        ON DUPLICATE KEY UPDATE
          pv_generation_kwh = VALUES(pv_generation_kwh),
          load_consumption_kwh = VALUES(load_consumption_kwh),
          grid_import_kwh = VALUES(grid_import_kwh),
          grid_export_kwh = VALUES(grid_export_kwh),
          battery_charge_kwh = VALUES(battery_charge_kwh),
          battery_discharge_kwh = VALUES(battery_discharge_kwh)
      `, [lastMonth]);

      console.log('\x1b[37m   • Aggregator - daily → monthly');
    } catch (error) {
      console.error(' \x1b[91m   • Aggregator - Monthly aggregation failed:', error.message,'\x1b[37m');
    }
  }

  /**
   * NEW: Aggregate raw device measurements into hourly/daily usage
   * This is critical for smart-plug performance tracking.
   */async aggregateDevices() {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Using the "Substring trick" ensures we get the delta between 
    // the actual first and last reading of the day.
    await db.pool.query(`
      INSERT INTO device_daily_usage (device_id, date, usage_kwh, last_update)
      SELECT 
        device_id,
        CURDATE() as date,
        (
          SUBSTRING_INDEX(MAX(CONCAT(timestamp, '|', energy_total)), '|', -1) - 
          SUBSTRING_INDEX(MIN(CONCAT(timestamp, '|', energy_total)), '|', -1)
        ) as usage_kwh,
        MAX(timestamp) as last_update
      FROM device_measurements
      WHERE timestamp >= CURDATE()
      GROUP BY device_id
      ON DUPLICATE KEY UPDATE 
        usage_kwh = VALUES(usage_kwh),
        last_update = VALUES(last_update)
    `);

    console.log('\x1b[37m   • Aggregator - device measurements → daily usage');
  } catch (error) {
    console.error('\x1b[91m   • Aggregator - Device aggregation failed:', error.message, '\x1b[37m');
  }
}

  async compareForecastWithActual() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    try {
      const [daily] = await db.pool.query(
        'SELECT pv_generation_kwh FROM energy_daily WHERE date = ?', [dateStr]
      );

      if (daily[0]) {
        const actual = daily[0].pv_generation_kwh;
        
        await db.pool.query(`
          UPDATE solar_forecasts 
          SET actual_kwh = ?, 
              accuracy_percentage = (actual_kwh / expected_kwh) * 100 
          WHERE date = ?
        `, [actual, dateStr]);

        console.log(`\x1b[37m   • SolarForecast - Updated forecast accuracy for ${dateStr}: ${actual} kWh`);
      }
    } catch (error) {
      console.error('\x1b[91m   • SolarForecast - comparison failed:', error.message,'\x1b[37m');
    }
  }
}

export default new AggregatorService();