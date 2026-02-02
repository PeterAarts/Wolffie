// modules/alphaess-cloud/collector.js
import db from '../../core/database.js';
import settingsService from '../../core/system/services/settingsService.js';
import alphaessAPI from './services/api.js';

class AlphaESSCloudCollector {
  constructor() {
    this.lastCollectionTime = null;
    this.lastError = null;
    this.consecutiveErrors = 0;
  }

  /**
   * Single collection cycle. Called by CollectorManager on schedule.
   * Returns true on success, false on failure.
   */
  async collect() {
    try {
      console.log('📡 Collecting from AlphaESS Cloud API...');

      const data = await alphaessAPI.getLastPowerData();
      const systemSn = await settingsService.get('cloud_api', 'system_sn');

      await this.storeData(data, systemSn);

      this.lastCollectionTime = new Date();
      this.lastError = null;
      this.consecutiveErrors = 0;

      console.log('✅ AlphaESS Cloud data collected successfully');
      return true;

    } catch (error) {
      this.lastError = error.message;
      this.consecutiveErrors++;
      console.error('❌ AlphaESS Cloud collection failed:', error.message);
      return false;
    }
  }

  /**
   * Store collected data in database
   */
  async storeData(data, systemSn = 'unknown') {
    const timestamp = new Date();

    // 1. Snapshot
    await db.pool.query(
      `INSERT INTO energy_snapshots (
        timestamp, source, device_id,
        battery_soc, battery_power, battery_voltage,
        solar_power, solar_energy_today,
        grid_power, grid_energy_import_today, grid_energy_export_today,
        load_power, load_energy_today,
        inverter_temp, inverter_power
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        timestamp, 'alphaess-cloud', systemSn,
        data.soc || 0, data.pbat || 0, data.vbat || 0,
        data.ppv || 0, data.epvToday || 0,
        data.pgrid || 0, data.einputToday || 0, data.eoutputToday || 0,
        data.pload || 0, data.eloadToday || 0,
        data.tempInv || 0, data.pinv || 0
      ]
    );

    // 2. Daily totals (upsert)
    const today = timestamp.toISOString().split('T')[0];

    await db.pool.query(
      `INSERT INTO energy_daily (
        date,
        pv_generation_kwh, load_consumption_kwh,
        grid_import_kwh, grid_export_kwh,
        battery_charge_kwh, battery_discharge_kwh
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        pv_generation_kwh = VALUES(pv_generation_kwh),
        load_consumption_kwh = VALUES(load_consumption_kwh),
        grid_import_kwh = VALUES(grid_import_kwh),
        grid_export_kwh = VALUES(grid_export_kwh),
        battery_charge_kwh = VALUES(battery_charge_kwh),
        battery_discharge_kwh = VALUES(battery_discharge_kwh)`,
      [
        today,
        data.epvToday || 0, data.eloadToday || 0,
        data.einputToday || 0, data.eoutputToday || 0,
        data.echargeToday || 0, data.edischargeToday || 0
      ]
    );

    console.log(`✅ Stored: SOC=${data.soc}%, Solar=${data.ppv}W, Load=${data.pload}W`);
  }

  /**
   * Status snapshot for CollectorManager reporting
   */
  getStatus() {
    return {
      lastCollection: this.lastCollectionTime,
      lastError: this.lastError,
      consecutiveErrors: this.consecutiveErrors
    };
  }
}

export default new AlphaESSCloudCollector();