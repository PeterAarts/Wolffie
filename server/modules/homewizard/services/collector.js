// modules/homewizard/services/collector.js
import db from '../../../core/database.js';
import homewizardAPI from './api.js';

class HomeWizardCollector {
  constructor() {
    this.devices = [];
    this.devicesLoaded = false;
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
      // Lazy-load devices on first run
      if (!this.devicesLoaded) {
        await this.loadDevices();
      }

      if (this.devices.length === 0) {
        console.log('ℹ️ HomeWizard: no devices configured, skipping');
        return true; // Not an error — just nothing to do
      }

      console.log(` - [${new Date().toISOString()}] Collecting from ${this.devices.length} HomeWizard device(s)...`);

      const results = await Promise.allSettled(
        this.devices.map(device => this.collectFromDevice(device))
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      if (failed > 0) {
        console.log(`⚠️ HomeWizard: ${successful} succeeded, ${failed} failed`);
      }

      this.lastCollectionTime = new Date();
      this.lastError = null;
      this.consecutiveErrors = 0;
      return failed === 0;

    } catch (error) {
      this.lastError = error.message;
      this.consecutiveErrors++;
      console.error('❌ HomeWizard collection failed:', error.message);
      return false;
    }
  }

  /**
   * Load configured HomeWizard devices from device_settings
   */
  async loadDevices() {
    try {
      const [devices] = await db.pool.query(
        `SELECT * FROM device_settings WHERE module = 'homewizard' AND enabled = 1`
      );
      this.devices = devices;
      this.devicesLoaded = true;
      console.log(`✅ HomeWizard: loaded ${devices.length} device(s)`);
    } catch (error) {
      console.error('❌ HomeWizard: failed to load devices:', error.message);
      this.devices = [];
      this.devicesLoaded = true; // Don't retry every tick — use reloadDevices() explicitly
    }
  }

  /**
   * Force a device list refresh (call after adding/removing devices via settings)
   */
  async reloadDevices() {
    this.devicesLoaded = false;
    await this.loadDevices();
  }

  /**
   * Collect from a single device
   */
  async collectFromDevice(device) {
    const port = device.port || 80;
    const data = await homewizardAPI.getData(device.ip_address, port);

    if (device.product_type === 'HWE-P1') {
      await this.storeP1Data(device, data);
    } else if (device.product_type === 'HWE-SKT') {
      await this.storeSocketData(device, data);
    } else if (device.product_type === 'HWE-KWH1' || device.product_type === 'HWE-KWH3') {
      await this.storeKwhMeterData(device, data);
    } else {
      await this.storeGenericData(device, data);
    }
  }

  // ─── Storage methods ────────────────────────────────────────────

  async storeP1Data(device, data) {
    const timestamp = new Date();

    await db.pool.query(
      `INSERT INTO device_measurements (
        timestamp, device_id, device_type, device_name, source,
        power, voltage, current, energy_today, energy_total, extra_metrics
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        timestamp,
        device.serial || device.ip_address,
        device.product_type,
        device.name,
        'homewizard',
        data.active_power_w || 0,
        data.active_voltage_v || 0,
        data.active_current_a || 0,
        (data.total_power_import_kwh || 0) + (data.total_power_export_kwh || 0),
        (data.total_power_import_t1_kwh || 0) + (data.total_power_import_t2_kwh || 0),
        JSON.stringify({
          active_power_l1_w: data.active_power_l1_w,
          active_power_l2_w: data.active_power_l2_w,
          active_power_l3_w: data.active_power_l3_w,
          active_voltage_l1_v: data.active_voltage_l1_v,
          active_voltage_l2_v: data.active_voltage_l2_v,
          active_voltage_l3_v: data.active_voltage_l3_v,
          active_current_l1_a: data.active_current_l1_a,
          active_current_l2_a: data.active_current_l2_a,
          active_current_l3_a: data.active_current_l3_a,
          total_power_import_t1_kwh: data.total_power_import_t1_kwh,
          total_power_import_t2_kwh: data.total_power_import_t2_kwh,
          total_power_export_t1_kwh: data.total_power_export_t1_kwh,
          total_power_export_t2_kwh: data.total_power_export_t2_kwh,
          gas_total_m3: data.total_gas_m3
        })
      ]
    );

    // If this is the primary grid meter, update the latest snapshot
    if (device.priority === 1) {
      await db.pool.query(
        `UPDATE energy_snapshots
         SET grid_power = ?
         WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)
         ORDER BY timestamp DESC
         LIMIT 1`,
        [data.active_power_w || 0]
      );
    }
  }

  async storeSocketData(device, data) {
    await db.pool.query(
      `INSERT INTO device_measurements (
        timestamp, device_id, device_type, device_name, source,
        power, energy_today, energy_total, extra_metrics
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        new Date(),
        device.serial || device.ip_address,
        device.product_type,
        device.name,
        'homewizard',
        data.active_power_w || 0,
        0,
        data.total_power_import_kwh || 0,
        JSON.stringify({ wifi_ssid: data.wifi_ssid, wifi_strength: data.wifi_strength })
      ]
    );
  }

  async storeKwhMeterData(device, data) {
    await db.pool.query(
      `INSERT INTO device_measurements (
        timestamp, device_id, device_type, device_name, source,
        power, energy_total, extra_metrics
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        new Date(),
        device.serial || device.ip_address,
        device.product_type,
        device.name,
        'homewizard',
        data.active_power_w || 0,
        data.total_power_import_kwh || 0,
        JSON.stringify({ active_liter_lpm: data.active_liter_lpm, total_liter_m3: data.total_liter_m3 })
      ]
    );
  }

  async storeGenericData(device, data) {
    await db.pool.query(
      `INSERT INTO device_measurements (
        timestamp, device_id, device_type, device_name, source,
        power, energy_total, extra_metrics
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        new Date(),
        device.serial || device.ip_address,
        device.product_type || 'unknown',
        device.name,
        'homewizard',
        data.active_power_w || data.power || 0,
        data.total_power_import_kwh || data.total_energy || 0,
        JSON.stringify(data)
      ]
    );
  }

  /**
   * Status snapshot for CollectorManager reporting
   */
  getStatus() {
    return {
      deviceCount: this.devices.length,
      lastCollection: this.lastCollectionTime,
      lastError: this.lastError,
      consecutiveErrors: this.consecutiveErrors
    };
  }
}

export default new HomeWizardCollector();