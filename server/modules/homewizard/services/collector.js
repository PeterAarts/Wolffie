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
        console.log('\x1b[91m   • HomeWizard: no devices configured, skipping');
        return true; // Not an error — just nothing to do
      }

      console.log(`\x1b[37m   • HomeWizard - ${new Date().toISOString()} Collecting from ${this.devices.length} device(s)...\x1b[37m`);

      const results = await Promise.allSettled(
        this.devices.map(device => this.collectFromDevice(device))
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      this.lastCollectionTime = new Date();
      this.lastError = null;
      this.consecutiveErrors = 0;
      return successful > 0;

    } catch (error) {
      this.lastError = error.message;
      this.consecutiveErrors++;
      console.error('\x1b[91m   • HomeWizard collection failed:', error.message,'\x1b[97m');
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
      console.log(`\x1b[37m   • HomeWizard: loaded ${devices.length} device(s)\x1b[37m`);
    } catch (error) {
      console.error('\x1b[91m   • HomeWizard: failed to load devices:', error.message,'\x1b[97m');
      this.devices = [];
      this.devicesLoaded = false; // Don't retry every tick — use reloadDevices() explicitly
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
/**
 * Collect from a single device
 */
async collectFromDevice(device) {
  const port = device.port || 80;
  const data = await homewizardAPI.getData(device.ip_address, port);

  // Fetch and persist control state for devices that support it
  await this.syncDeviceState(device, port);

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

/**
 * Fetch /api/v1/state from the device and persist power_on, switch_lock,
 * brightness back into device_settings. Devices that don't support state
 * (e.g. HWE-P1) return HTTP 422 — that is silently ignored.
 */
async syncDeviceState(device, port) {
  try {
    const state = await homewizardAPI.getState(device.ip_address, port);

    // Only update columns that are actually present in the response
    const updates = {};
    if (typeof state.power_on    === 'boolean') updates.power_on    = state.power_on    ? 1 : 0;
    if (typeof state.switch_lock === 'boolean') updates.switch_lock = state.switch_lock ? 1 : 0;
    if (typeof state.brightness  === 'number')  updates.brightness  = state.brightness;

    if (Object.keys(updates).length === 0) return;

    const setClauses = Object.keys(updates).map(k => `${k} = ?`);
    const values     = Object.values(updates);

    await db.pool.query(
      `UPDATE device_settings SET ${setClauses.join(', ')} WHERE id = ?`,
      [...values, device.id]
    );
  } catch (error) {
    // 422 = device doesn't support state (P1 meter etc.) — not an error worth logging
    if (!error.message.includes('does not support state')) {
      console.warn(`\x1b[93m   • HomeWizard: could not sync state for ${device.name}: ${error.message}\x1b[37m`);
    }
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