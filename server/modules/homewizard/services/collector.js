// modules/homewizard/services/collector.js
import db from '../../../core/database.js';
import homewizardAPI from './api.js';
import { localTimestamp } from '../../../core/utils/localTimestamp.js';
import { padName } from '../../../core/utils/logger.js';
const PREFIX = padName('HomeWizard');

// Device types that do NOT support /api/v1/state (power_on, switch_lock, brightness)
const STATE_UNSUPPORTED = new Set(['HWE-P1', 'HWE-KWH1', 'HWE-KWH3']);

// Source identifier written to energy_snapshots.source — must match the
// moduleId registered in capabilityRegistry so the aggregator's source map
// resolves correctly. Other P1 modules should set their own equivalent constant.
const MODULE_SOURCE = 'homewizard';

class HomeWizardCollector {
  constructor() {
    this.devices           = [];
    this.devicesLoaded     = false;
    this.lastCollectionTime = null;
    this.lastError         = null;
    this.consecutiveErrors = 0;

    // Per-device midnight baseline for computing daily energy deltas.
    // P1 meters report lifetime cumulative kWh, not a daily-resetting counter.
    // Key: device serial or ip_address. Value: { date, import_kwh, export_kwh }
    this._baseline = new Map();
  }

  // ── Public collect entry point ─────────────────────────────────────────────

  async collect() {
    try {
      if (!this.devicesLoaded) await this.loadDevices();
      if (this.devices.length === 0) return true;

      console.log(`\x1b[37m   • ${PREFIX} – ${localTimestamp()} Collecting from ${this.devices.length} device(s)...\x1b[37m`);

      const results = await Promise.allSettled(
        this.devices.map(device => this.collectFromDevice(device))
      );

      this.lastCollectionTime = new Date();
      this.lastError          = null;
      this.consecutiveErrors  = 0;
      return results.filter(r => r.status === 'fulfilled').length > 0;

    } catch (error) {
      this.lastError = error.message;
      this.consecutiveErrors++;
      console.error(`\x1b[91m   • ${PREFIX} collection failed:`, error.message, '\x1b[97m');
      return false;
    }
  }

  // ── Device loading ─────────────────────────────────────────────────────────

  async loadDevices() {
    try {
      const [devices] = await db.pool.query(
        `SELECT * FROM device_settings WHERE module = 'homewizard' AND enabled = 1`
      );
      this.devices       = devices;
      this.devicesLoaded = true;
      console.log(`\x1b[37m   • ${PREFIX}: loaded ${devices.length} device(s)\x1b[37m`);
    } catch (error) {
      console.error(`\x1b[91m   • ${PREFIX}: failed to load devices:`, error.message, '\x1b[97m');
      this.devices       = [];
      this.devicesLoaded = false;
    }
  }

  async reloadDevices() {
    this.devicesLoaded = false;
    await this.loadDevices();
  }

  // ── Per-device collection ──────────────────────────────────────────────────

  async collectFromDevice(device) {
    const port = device.port || 80;
    const data = await homewizardAPI.getData(device.ip_address, port);

    if (!STATE_UNSUPPORTED.has(device.product_type)) {
      await this.syncDeviceState(device, port);
    }

    if      (device.product_type === 'HWE-P1')                                          await this.storeP1Data(device, data);
    else if (device.product_type === 'HWE-SKT')                                         await this.storeSocketData(device, data);
    else if (device.product_type === 'HWE-KWH1' || device.product_type === 'HWE-KWH3') await this.storeKwhMeterData(device, data);
    else                                                                                 await this.storeGenericData(device, data);
  }

  async syncDeviceState(device, port) {
    try {
      const state   = await homewizardAPI.getState(device.ip_address, port);
      const updates = {};
      if (typeof state.power_on    === 'boolean') updates.power_on    = state.power_on    ? 1 : 0;
      if (typeof state.switch_lock === 'boolean') updates.switch_lock = state.switch_lock ? 1 : 0;
      if (typeof state.brightness  === 'number')  updates.brightness  = state.brightness;
      if (!Object.keys(updates).length) return;

      const setClauses = Object.keys(updates).map(k => `${k} = ?`);
      await db.pool.query(
        `UPDATE device_settings SET ${setClauses.join(', ')} WHERE id = ?`,
        [...Object.values(updates), device.id]
      );
    } catch (error) {
      if (!error.message.includes('does not support state')) {
        console.warn(`\x1b[93m   • ${PREFIX}: could not sync state for ${device.name}: ${error.message}\x1b[37m`);
      }
    }
  }

  // ── P1 storage ─────────────────────────────────────────────────────────────

  async storeP1Data(device, data) {
    const deviceKey = device.serial || device.ip_address;

    // Compute total grid power from per-phase values as fallback.
    const gridPower = data.active_power_w
      ?? ((data.active_power_l1_w ?? 0) + (data.active_power_l2_w ?? 0) + (data.active_power_l3_w ?? 0))
      ?? null;

    // All energy_snapshots rows use local time (CET/CEST without offset marker)
    // to match alphaess-cloud and the aggregator's strftime hour bucketing.
    // Earlier versions of this file wrote UTC here to align with the (now-removed)
    // Modbus collectors that used .toISOString(); that constraint is obsolete.
    const localNow = localTimestamp();

    // 1. Write raw P1 record to device_measurements (unchanged)
    await db.pool.query(
      `INSERT INTO device_measurements (
        timestamp, device_id, device_type, device_name, source,
        power, voltage, current, energy_today, energy_total, extra_metrics
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        localTimestamp(),
        deviceKey,
        device.product_type,
        device.name,
        MODULE_SOURCE,
        gridPower ?? 0,
        data.active_voltage_v ?? 0,
        data.active_current_a ?? 0,
        (data.total_power_import_kwh ?? 0) + (data.total_power_export_kwh ?? 0),
        (data.total_power_import_t1_kwh ?? 0) + (data.total_power_import_t2_kwh ?? 0),
        JSON.stringify({
          active_power_l1_w:         data.active_power_l1_w,
          active_power_l2_w:         data.active_power_l2_w,
          active_power_l3_w:         data.active_power_l3_w,
          active_voltage_l1_v:       data.active_voltage_l1_v,
          active_voltage_l2_v:       data.active_voltage_l2_v,
          active_voltage_l3_v:       data.active_voltage_l3_v,
          active_current_l1_a:       data.active_current_l1_a,
          active_current_l2_a:       data.active_current_l2_a,
          active_current_l3_a:       data.active_current_l3_a,
          total_power_import_t1_kwh: data.total_power_import_t1_kwh,
          total_power_import_t2_kwh: data.total_power_import_t2_kwh,
          total_power_export_t1_kwh: data.total_power_export_t1_kwh,
          total_power_export_t2_kwh: data.total_power_export_t2_kwh,
          gas_total_m3:              data.total_gas_m3,
        }),
      ]
    );

    // 2. Compute daily import/export deltas from lifetime cumulative values
    const { importToday, exportToday } = this._getDailyDelta(deviceKey, data);

    // 3. Write P1 snapshot row.
    //
    //    Fields this module OWNS:
    //      load_power             — active_power_w is net house consumption as seen
    //                               by P1 meter (installed after AlphaESS EPS port).
    //                               Always stored as positive (consumption only).
    //      load_energy_today      — daily import kWh delta
    //      grid_voltage_l1/l2/l3 — AC bus voltage
    //      grid_current_l1/l2/l3 — AC bus current
    //      grid_frequency         — AC frequency
    //
    //    Fields NOT OWNED → NULL:
    //      grid_power             — P1 is after AlphaESS EPS port; it does NOT see
    //                               grid import/export. AlphaESS Modbus is authoritative.
    //      solar_*, battery_*     — not measured by P1.
    //      grid_energy_import/export_today — not reliable from this meter position.
    await db.pool.query(
      `INSERT INTO energy_snapshots (
        timestamp, source, device_id,
        solar_power, solar_energy_today,
        battery_power, battery_soc, battery_voltage, battery_current, battery_temp,
        grid_power,
        grid_voltage_l1, grid_voltage_l2, grid_voltage_l3,
        grid_current_l1, grid_current_l2, grid_current_l3,
        grid_frequency,
        grid_energy_import_today, grid_energy_export_today,
        load_power, load_energy_today,
        inverter_temp, inverter_power,
        battery_charge_today, battery_discharge_today
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(timestamp, source) DO UPDATE SET
        load_power               = excluded.load_power,
        load_energy_today        = excluded.load_energy_today,
        grid_voltage_l1          = excluded.grid_voltage_l1,
        grid_voltage_l2          = excluded.grid_voltage_l2,
        grid_voltage_l3          = excluded.grid_voltage_l3,
        grid_current_l1          = excluded.grid_current_l1,
        grid_current_l2          = excluded.grid_current_l2,
        grid_current_l3          = excluded.grid_current_l3,
        grid_frequency           = excluded.grid_frequency`,
      [
        localNow,
        MODULE_SOURCE,
        deviceKey,
        // ── NOT OWNED → NULL ──────────────────────────────────────────────────
        null,           // solar_power
        null,           // solar_energy_today
        null,           // battery_power
        null,           // battery_soc
        null,           // battery_voltage
        null,           // battery_current
        null,           // battery_temp
        null,           // grid_power — AlphaESS Modbus is authoritative
        // ── OWNED ─────────────────────────────────────────────────────────────
        data.active_voltage_l1_v ?? data.active_voltage_v ?? null,
        data.active_voltage_l2_v ?? null,
        data.active_voltage_l3_v ?? null,
        data.active_current_l1_a ?? data.active_current_a ?? null,
        data.active_current_l2_a ?? null,
        data.active_current_l3_a ?? null,
        data.active_frequency_hz ?? null,
        // ── NOT OWNED → NULL ──────────────────────────────────────────────────
        null,           // grid_energy_import_today
        null,           // grid_energy_export_today
        // ── OWNED ─────────────────────────────────────────────────────────────
        gridPower !== null ? Math.abs(gridPower) : null,  // load_power — always positive
        importToday,    // load_energy_today
        // ── NOT OWNED → NULL ──────────────────────────────────────────────────
        null,           // inverter_temp
        null,           // inverter_power
        null,           // battery_charge_today
        null,           // battery_discharge_today
      ]
    );
  }

  // ── Daily delta calculation ────────────────────────────────────────────────
  //
  // P1 meters expose lifetime cumulative kWh that never reset.
  // We track a per-device in-memory baseline (set once per calendar day) and
  // subtract it from the current reading to produce today's value.
  //
  // A server restart mid-day resets the baseline, producing a conservative
  // undercount for that day only — acceptable for home energy monitoring.
  // The lifetime totals in device_measurements remain accurate regardless.

  _getDailyDelta(deviceKey, data) {
    // Local date — must match the timezone used for energy_snapshots rows
    // so the daily reset happens at local midnight, not UTC midnight.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const currentImport = (data.total_power_import_t1_kwh ?? 0)
                        + (data.total_power_import_t2_kwh ?? 0);
    const currentExport = (data.total_power_export_t1_kwh ?? 0)
                        + (data.total_power_export_t2_kwh ?? 0);

    const baseline = this._baseline.get(deviceKey);

    // First collection of this day (or first ever) — record baseline, return 0
    if (!baseline || baseline.date !== today) {
      this._baseline.set(deviceKey, {
        date:       today,
        import_kwh: currentImport,
        export_kwh: currentExport,
      });
      return { importToday: 0, exportToday: 0 };
    }

    return {
      importToday: Math.max(0, Math.round((currentImport - baseline.import_kwh) * 1000) / 1000),
      exportToday: Math.max(0, Math.round((currentExport - baseline.export_kwh) * 1000) / 1000),
    };
  }

  // ── Other device types (unchanged) ────────────────────────────────────────

  async storeSocketData(device, data) {
    await db.pool.query(
      `INSERT INTO device_measurements (
        timestamp, device_id, device_type, device_name, source,
        power, energy_today, energy_total, extra_metrics
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        localTimestamp(),
        device.serial || device.ip_address,
        device.product_type,
        device.name,
        MODULE_SOURCE,
        data.active_power_w         ?? 0,
        0,
        data.total_power_import_kwh ?? 0,
        JSON.stringify({ wifi_ssid: data.wifi_ssid, wifi_strength: data.wifi_strength }),
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
        localTimestamp(),
        device.serial || device.ip_address,
        device.product_type,
        device.name,
        MODULE_SOURCE,
        data.active_power_w         ?? 0,
        data.total_power_import_kwh ?? 0,
        JSON.stringify({ active_liter_lpm: data.active_liter_lpm, total_liter_m3: data.total_liter_m3 }),
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
        localTimestamp(),
        device.serial       || device.ip_address,
        device.product_type || 'unknown',
        device.name,
        MODULE_SOURCE,
        data.active_power_w         ?? data.power        ?? 0,
        data.total_power_import_kwh ?? data.total_energy ?? 0,
        JSON.stringify(data),
      ]
    );
  }

  getStatus() {
    return {
      deviceCount:       this.devices.length,
      lastCollection:    this.lastCollectionTime,
      lastError:         this.lastError,
      consecutiveErrors: this.consecutiveErrors,
    };
  }
}

export default new HomeWizardCollector();