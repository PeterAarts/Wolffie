// modules/alphaess-modbus-tcp/services/collector.js
import db from '../../../core/database.js';
import api from './api.js';

/**
 * Wolffie AlphaESS ModBus Collector - v6.9
 * Bridge between SMILE G3-T10 hardware and energy_snapshots SQL table.
 * Fully aligned with the 30-column schema and Cloud collector pattern.
 *
 * Config/connection is owned by index.js — collector uses api directly.
 *
 * v6.9: NULL for unowned/unavailable fields instead of 0.
 *   AVG() in aggregation queries skips NULLs — prevents cross-source dilution.
 *
 * Fields this module OWNS (real values stored):
 *   battery_power, battery_soc, grid_power, grid_voltage_l1, grid_frequency,
 *   grid_energy_import_today, grid_energy_export_today, load_power,
 *   load_energy_today, inverter_temp, inverter_power,
 *   battery_charge_today, battery_discharge_today
 *
 * Fields NOT available via ModBus TCP on G3-T10 → NULL:
 *   solar_power, solar_energy_today   — SolarEdge is authoritative source
 *   battery_voltage, battery_current, battery_temp — not exposed via TCP
 *   grid_voltage_l2/l3, grid_current_l1/l2/l3     — single-phase, not exposed
 */
class AlphaModbusCollector {
  constructor() {
    this.lastCollectionTime = null;
    this.lastError          = null;
    this.consecutiveErrors  = 0;
    this.config             = null;
  }

  async collect() {
    try {
      return await this._doCollect();
    } catch (e) {
      console.error(`\x1b[31m   • AlphaESS ModBus Collector [outer guard]: ${e.message}\x1b[37m`);
      this.lastError = e.message;
      this.consecutiveErrors++;
      try { await api.client.close(); } catch (_) {}
      api.isConnected = false;
      return false;
    }
  }

  async _doCollect() {
    if (!this.config?.host) {
      console.warn(`   • AlphaESS ModBus: no config available yet, skipping`);
      return true;
    }

    // ── Connect ───────────────────────────────────────────────────────────────
    try {
      try { await api.client.close(); } catch (_) {}
      api.isConnected = false;
      await api.connect(this.config.host, this.config.port, this.config.unit_id);
    } catch (connErr) {
      console.error(`\x1b[31m   • AlphaESS ModBus Collector Error: ${connErr.message}\x1b[37m`);
      this.lastError = connErr.message;
      this.consecutiveErrors++;
      try { await api.client.close(); } catch (_) {}
      api.isConnected = false;
      return false;
    }

    // ── Fetch registers ───────────────────────────────────────────────────────
    let m;
    try {
      m = await api.fetchAll();
    } catch (fetchErr) {
      console.error(`\x1b[31m   • AlphaESS ModBus Collector Error: ${fetchErr.message}\x1b[37m`);
      this.lastError = fetchErr.message;
      this.consecutiveErrors++;
      try { await api.client.close(); } catch (_) {}
      api.isConnected = false;
      return false;
    }

    // ── Grid power source ─────────────────────────────────────────────────────
    const gridPowerSource = this.config?.grid_power_source ?? 'internal';
    let gridPowerDB = null;

    if (gridPowerSource === 'internal') {
      gridPowerDB = m.grid.total_active_power * -1;
    } else if (gridPowerSource === 'homewizard-p1') {
      try {
        const [p1Rows] = await db.pool.query(
          `SELECT grid_power FROM energy_snapshots
           WHERE source = 'homewizard-p1'
           ORDER BY timestamp DESC LIMIT 1`
        );
        if (p1Rows.length > 0 && p1Rows[0].grid_power !== null) {
          gridPowerDB = p1Rows[0].grid_power;
        } else {
          gridPowerDB = m.grid.total_active_power * -1;
          console.warn(`   • AlphaESS ModBus: grid_power_source=homewizard-p1 but no P1 snapshot found, falling back to internal register`);
        }
      } catch (err) {
        gridPowerDB = m.grid.total_active_power * -1;
        console.warn(`   • AlphaESS ModBus: P1 grid power query failed: ${err.message}, falling back to internal register`);
      }
    }

    // ── Calculate load ────────────────────────────────────────────────────────
    const loadPower = Math.max(0,
      m.solar.total_power + m.battery.power + gridPowerDB
    );

    const loadEnergyToday = m.home?.energy_today ?? Math.max(0,
      m.solar.energy_today +
      (m.grid.import_today - m.grid.export_today) +
      (m.battery.discharge_today - m.battery.charge_today)
    );

    // ── Store ─────────────────────────────────────────────────────────────────
    await this.storeSnapshot(m, gridPowerDB, loadPower, loadEnergyToday);

    this.lastCollectionTime = new Date();
    this.lastError          = null;
    this.consecutiveErrors  = 0;
    console.log(`   • AlphaESS ModBus - ${new Date().toISOString()} SOC=${Math.round(m.battery.soc)}%  Solar=${m.solar.total_power}W  Battery=${m.battery.power}W  Grid(raw)=${m.grid.total_active_power}W  Grid(DB)=${gridPowerDB}W  Load=${Math.round(loadPower)}W`);
    return true;
  }

  async storeSnapshot(m, gridPowerDB, loadPower, loadEnergyToday) {
    await db.pool.query(
      `INSERT INTO energy_snapshots (
        timestamp,
        source,
        device_id,
        solar_power,
        solar_energy_today,
        battery_power,
        battery_soc,
        battery_voltage,
        battery_current,
        battery_temp,
        grid_power,
        grid_voltage_l1,
        grid_voltage_l2,
        grid_voltage_l3,
        grid_current_l1,
        grid_current_l2,
        grid_current_l3,
        grid_frequency,
        grid_energy_import_today,
        grid_energy_export_today,
        load_power,
        load_energy_today,
        inverter_temp,
        inverter_power,
        battery_charge_today,
        battery_discharge_today,
        trees_equivalent,
        co2_offset_kg
      ) VALUES (NOW(3), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'alphaess-modbus-tcp',          // source
        'alpha-smile-g3-t10',           // device_id

        // ── NOT OWNED → NULL ──────────────────────────────────────────────────
        // SolarEdge is the authoritative solar source; AlphaESS MPPT inputs
        // are empty (pv_power register 0x041F always returns 0 on this install).
        null,                           // solar_power
        null,                           // solar_energy_today

        // ── OWNED ─────────────────────────────────────────────────────────────
        m.battery.power,                // battery_power
        Math.round(m.battery.soc),      // battery_soc

        // ── NOT AVAILABLE via ModBus TCP on G3-T10 → NULL ─────────────────────
        null,                           // battery_voltage
        null,                           // battery_current
        null,                           // battery_temp

        // ── OWNED ─────────────────────────────────────────────────────────────
        gridPowerDB,                    // grid_power
        m.grid.l1_voltage,              // grid_voltage_l1

        // ── NOT AVAILABLE (single-phase, not exposed via TCP) → NULL ──────────
        null,                           // grid_voltage_l2
        null,                           // grid_voltage_l3
        null,                           // grid_current_l1
        null,                           // grid_current_l2
        null,                           // grid_current_l3

        // ── OWNED ─────────────────────────────────────────────────────────────
        m.system.inv_freq ?? 50.0,      // grid_frequency
        m.grid.import_today,            // grid_energy_import_today
        m.grid.export_today,            // grid_energy_export_today
        Math.round(loadPower),          // load_power
        loadEnergyToday,                // load_energy_today
        m.system.inverter_temp,         // inverter_temp
        m.solar.total_power,            // inverter_power  (AC output of AlphaESS inverter)
        m.battery.charge_today,         // battery_charge_today
        m.battery.discharge_today,      // battery_discharge_today
        0.0,                            // trees_equivalent
        0.0,                            // co2_offset_kg
      ]
    );
  }

  getStatus() {
    return {
      lastCollection:    this.lastCollectionTime,
      lastError:         this.lastError,
      consecutiveErrors: this.consecutiveErrors,
    };
  }
}

export default new AlphaModbusCollector();