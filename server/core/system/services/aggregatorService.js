// server/core/system/services/aggregatorService.js
// Aggregates data from energy_snapshots into hourly/daily/monthly tables

import db from '../../database.js';

class AggregatorService {
  constructor() {
    this.isRunning = false;
    this.aggregationInterval = null;
  }

  /**
   * Start aggregation service
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ Aggregator already running');
      return;
    }

    console.log('🚀 Starting data aggregator...');
    this.isRunning = true;

    // Aggregate immediately
    this.aggregate();

    // Then aggregate every minute
    this.aggregationInterval = setInterval(async () => {
      await this.aggregate();
    }, 60000); // 1 minute

    console.log('✅ Data aggregator started (1 minute interval)');
  }

  /**
   * Stop aggregation service
   */
  stop() {
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
      this.aggregationInterval = null;
    }
    this.isRunning = false;
    console.log('🛑 Data aggregator stopped');
  }

  /**
   * Run all aggregations
   */
  async aggregate() {
    try {
      await this.aggregateMinutes();
      await this.aggregateHours();
      await this.aggregateDaily();
      await this.aggregateMonthly();
    } catch (error) {
      console.error('❌ Aggregation error:', error.message);
    }
  }

  /**
   * Aggregate snapshots into 1-minute averages
   */
  async aggregateMinutes() {
    try {
      // Get the last minute that was aggregated
      const [lastAgg] = await db.pool.query(
        'SELECT MAX(timestamp) as last_time FROM energy_minutes'
      );

      const lastTime = lastAgg[0]?.last_time || new Date(0);

      // Aggregate snapshots from the last aggregated time until now
      // Group by 1-minute intervals
      await db.pool.query(`
        INSERT INTO energy_minutes (
          timestamp,
          battery_soc_avg,
          battery_power_avg,
          solar_power_avg,
          grid_power_avg,
          load_power_avg,
          sample_count
        )
        SELECT 
          DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:00') as minute_timestamp,
          AVG(battery_soc) as battery_soc_avg,
          AVG(battery_power) as battery_power_avg,
          AVG(solar_power) as solar_power_avg,
          AVG(grid_power) as grid_power_avg,
          AVG(load_power) as load_power_avg,
          COUNT(*) as sample_count
        FROM energy_snapshots
        WHERE timestamp > ?
        GROUP BY minute_timestamp
        ON DUPLICATE KEY UPDATE
          battery_soc_avg = VALUES(battery_soc_avg),
          battery_power_avg = VALUES(battery_power_avg),
          solar_power_avg = VALUES(solar_power_avg),
          grid_power_avg = VALUES(grid_power_avg),
          load_power_avg = VALUES(load_power_avg),
          sample_count = VALUES(sample_count)
      `, [lastTime]);

    } catch (error) {
      console.error('❌ Minute aggregation failed:', error.message);
    }
  }

  /**
   * Aggregate minutes into hourly data
   */
  async aggregateHours() {
    try {
      const [lastAgg] = await db.pool.query(
        'SELECT MAX(timestamp) as last_time FROM energy_hours'
      );

      const lastTime = lastAgg[0]?.last_time || new Date(0);

      await db.pool.query(`
        INSERT INTO energy_hours (
          timestamp,
          battery_soc_avg,
          battery_power_avg,
          solar_power_avg,
          grid_power_avg,
          load_power_avg,
          solar_energy_kwh,
          grid_import_kwh,
          grid_export_kwh,
          battery_charge_kwh,
          battery_discharge_kwh,
          load_energy_kwh
        )
        SELECT 
          DATE_FORMAT(timestamp, '%Y-%m-%d %H:00:00') as hour_timestamp,
          AVG(battery_soc_avg) as battery_soc_avg,
          AVG(battery_power_avg) as battery_power_avg,
          AVG(solar_power_avg) as solar_power_avg,
          AVG(grid_power_avg) as grid_power_avg,
          AVG(load_power_avg) as load_power_avg,
          SUM(CASE WHEN solar_power_avg > 0 THEN solar_power_avg / 1000 / 60 ELSE 0 END) as solar_energy_kwh,
          SUM(CASE WHEN grid_power_avg > 0 THEN grid_power_avg / 1000 / 60 ELSE 0 END) as grid_import_kwh,
          SUM(CASE WHEN grid_power_avg < 0 THEN ABS(grid_power_avg) / 1000 / 60 ELSE 0 END) as grid_export_kwh,
          SUM(CASE WHEN battery_power_avg > 0 THEN battery_power_avg / 1000 / 60 ELSE 0 END) as battery_charge_kwh,
          SUM(CASE WHEN battery_power_avg < 0 THEN ABS(battery_power_avg) / 1000 / 60 ELSE 0 END) as battery_discharge_kwh,
          SUM(CASE WHEN load_power_avg > 0 THEN load_power_avg / 1000 / 60 ELSE 0 END) as load_energy_kwh
        FROM energy_minutes
        WHERE timestamp > ?
        GROUP BY hour_timestamp
        ON DUPLICATE KEY UPDATE
          battery_soc_avg = VALUES(battery_soc_avg),
          battery_power_avg = VALUES(battery_power_avg),
          solar_power_avg = VALUES(solar_power_avg),
          grid_power_avg = VALUES(grid_power_avg),
          load_power_avg = VALUES(load_power_avg),
          solar_energy_kwh = VALUES(solar_energy_kwh),
          grid_import_kwh = VALUES(grid_import_kwh),
          grid_export_kwh = VALUES(grid_export_kwh),
          battery_charge_kwh = VALUES(battery_charge_kwh),
          battery_discharge_kwh = VALUES(battery_discharge_kwh),
          load_energy_kwh = VALUES(load_energy_kwh)
      `, [lastTime]);

    } catch (error) {
      console.error('❌ Hour aggregation failed:', error.message);
    }
  }

  /**
   * Aggregate hours into daily data
   */
  async aggregateDaily() {
    try {
      const [lastAgg] = await db.pool.query(
        'SELECT MAX(date) as last_date FROM energy_daily'
      );

      const lastDate = lastAgg[0]?.last_date || '1970-01-01';

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
          SUM(solar_energy_kwh) as pv_generation_kwh,
          SUM(load_energy_kwh) as load_consumption_kwh,
          SUM(grid_import_kwh) as grid_import_kwh,
          SUM(grid_export_kwh) as grid_export_kwh,
          SUM(battery_charge_kwh) as battery_charge_kwh,
          SUM(battery_discharge_kwh) as battery_discharge_kwh
        FROM energy_hours
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

    } catch (error) {
      console.error('❌ Daily aggregation failed:', error.message);
    }
  }

  /**
   * Aggregate daily into monthly data
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

    } catch (error) {
      console.error('❌ Monthly aggregation failed:', error.message);
    }
  }
}

export default new AggregatorService();