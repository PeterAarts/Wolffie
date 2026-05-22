// modules/alphaess-modbus-tcp/services/collector.js
import db from '../../../core/database.js';
import api from './api.js';
import alertService from '../../../core/system/services/alertService.js';
import eventService from '../../../core/system/services/eventService.js';
import { localTimestamp } from '../../../core/utils/localTimestamp.js';
import { padName } from '../../../core/utils/logger.js';
const PREFIX = padName('AlphaESS ModBus');

/**
 * Wolffie AlphaESS ModBus Collector - v6.14
 * Bridge between SMILE G3-T10 hardware and energy_snapshots SQL table.
 * Fully aligned with the 30-column schema and Cloud collector pattern.
 *
 * Config/connection is owned by index.js — collector uses api directly.
 *
 * v6.14: timestamps now written in local time (CET/CEST without offset marker)
 *   to match alphaess-cloud / homewizard / wolffie-core / solaredge-modbus.
 *   Earlier versions used datetime('now') which SQLite interprets as UTC,
 *   putting modbus rows 1–2 hours apart from cloud rows in the same column.
 *
 * v6.13: load_power and load_energy_today removed from this collector.
 *   Load is now derived by collectorManager._runDerivedMetrics() using
 *   capability registry readings (solar:read, battery:read, grid:read).
 *   Written to energy_snapshots with source = 'wolffie-core'.
 *   This keeps module collectors independent — no cross-module imports.
 *
 * v6.9: NULL for unowned/unavailable fields instead of 0.
 *   AVG() in aggregation queries skips NULLs — prevents cross-source dilution.
 *
 * Fields this module OWNS (real values stored):
 *   battery_power, battery_soc, grid_power, grid_voltage_l1, grid_frequency,
 *   grid_energy_import_today, grid_energy_export_today,
 *   inverter_temp, inverter_power,
 *   battery_charge_today, battery_discharge_today
 *
 * Fields NOT available via ModBus TCP on G3-T10 → NULL:
 *   solar_power, solar_energy_today   — SolarEdge is authoritative source
 *   load_power, load_energy_today     — derived by wolffie-core (collectorManager)
 *   battery_voltage, battery_current, battery_temp — not exposed via TCP
 *   grid_voltage_l2/l3, grid_current_l1/l2/l3     — single-phase, not exposed
 */
class AlphaModbusCollector {
  constructor() {
    this.lastCollectionTime = null;
    this.lastError          = null;
    this.consecutiveErrors  = 0;
    this.config             = null;
    // Cache of the last successful fetchAll() result, served by getLastSnapshot().
    this._lastData          = null;
    // Last known inverter mode — used to detect grid outage/recovery transitions.
    // null = unknown (first run), avoids false alert on startup.
    this._lastInverterMode  = null;
  }

  async collect() {
    try {
      return await this._doCollect();
    } catch (e) {
      console.error(`\x1b[31m   • ${PREFIX} [outer guard]: ${e.message}\x1b[37m`);
      this.lastError = e.message;
      this.consecutiveErrors++;
      return false;
    }
  }

  async _doCollect() {
    if (!this.config?.host) {
      console.warn(`   • ${PREFIX}: no config available yet, skipping`);
      return true;
    }

    // ── Connect → fetch (direct, no _connMutex) ──────────────────────────────
    // We use api.connect() directly — the same path the test script uses — to
    // avoid any _connMutex chaining issues that could silently prevent the
    // collection from ever running.
    //
    // api.connect() (patched) always closes before connecting, removing the
    // stale-socket ECONNRESET bug. The connection is kept open after a successful
    // fetch; it will be closed + reopened at the START of the next cycle so
    // AlphaESS's TCP stack is not hammered with rapid reconnects.
    //
    // Control writes (startCharge, stopDispatch) use withConnection() via
    // _connMutex — they are rare and the close-after behaviour is correct there.
    try {
      await api.connect(this.config.host, this.config.port, this.config.unit_id);
    } catch (connErr) {
      console.error(`\x1b[31m   • ${PREFIX} Error: ${connErr.message}\x1b[37m`);
      this.lastError = connErr.message;
      this.consecutiveErrors++;
      return false;
    }

    let m;
    try {
      m = await api.fetchAll();
    } catch (fetchErr) {
      console.error(`\x1b[31m   • ${PREFIX} Error: ${fetchErr.message}\x1b[37m`);
      this.lastError = fetchErr.message;
      this.consecutiveErrors++;
      await api.safeClose();
      api.isConnected = false;
      return false;
    }

    // ── Grid power source ─────────────────────────────────────────────────────
    const gridPowerSource = this.config?.grid_power_source ?? 'p1-meter';
    let gridPowerDB = null;

    if (gridPowerSource === 'internal') {
      // AlphaESS register convention: positive = importing, negative = exporting.
      // No inversion needed — store as-is.
      gridPowerDB = m.grid.total_active_power;
    } else if (gridPowerSource === 'p1-meter') {
      try {
        const [p1Rows] = await db.pool.query(
          `SELECT grid_power FROM energy_snapshots
           WHERE source = 'p1-meter'
           ORDER BY timestamp DESC LIMIT 1`
        );
        if (p1Rows.length > 0 && p1Rows[0].grid_power !== null) {
          gridPowerDB = p1Rows[0].grid_power;
        } else {
          gridPowerDB = m.grid.total_active_power;
          console.warn(`   • ${PREFIX} - grid_power_source=p1-meter but no P1 snapshot found, falling back to internal register`);
        }
      } catch (err) {
        gridPowerDB = m.grid.total_active_power;
        console.warn(`   • ${PREFIX} - P1 grid power query failed: ${err.message}, falling back to internal register`);
      }
    }

    // ── Inverter mode — grid outage detection ─────────────────────────────────
    let inverterMode = null;
    try {
      inverterMode = await api.readInverterMode();

      // Only act on a confirmed transition — ignore first run (null baseline)
      if (this._lastInverterMode !== null) {
        const wasConnected = this._lastInverterMode.gridConnected;
        const isConnected  = inverterMode.gridConnected;

        if (wasConnected && !isConnected) {
          // Grid just dropped → raise alert + log event
          console.warn(`\x1b[31m   • ${PREFIX} -⚡Grid outage detected — mode: ${inverterMode.mode}\x1b[37m`);
          await alertService.write('hardware', 'alphaess-modbus-tcp', {
            type:       'grid_outage',
            severity:   'error',
            message:    `Grid power unavailable — running on battery (${inverterMode.mode}).`,
            suggestion: 'Reduce power consumption. Battery will deplete without grid.',
            action:     '',
          }, 9999); // large dedup window — only one active alert until resolved
          await eventService.log({
            category: 'SAFETY',
            action:   'GRID_OUTAGE',
            source:   'alphaess-modbus-tcp',
            userId:   null,
            details:  { mode: inverterMode.mode },
          });

        } else if (!wasConnected && isConnected) {
          // Grid restored → auto-resolve alert + log recovery
          console.log(`\x1b[32m   • ${PREFIX} - ✅ Grid restored — mode: ${inverterMode.mode}\x1b[37m `);
          await alertService.resolveByTypePrefix('hardware', 'grid_outage');
          await eventService.log({
            category: 'SAFETY',
            action:   'GRID_RESTORED',
            source:   'alphaess-modbus-tcp',
            userId:   null,
            details:  { mode: inverterMode.mode },
          });
        }
      }

      this._lastInverterMode = inverterMode;
    } catch (modeErr) {
      // Non-fatal — don't abort the collection cycle if mode read fails
      console.warn(`   • ${PREFIX} readInverterMode failed: ${modeErr.message}`);
    }

    // ── Store ─────────────────────────────────────────────────────────────────
    // load_power and load_energy_today are NOT stored here — they are derived
    // by collectorManager._runDerivedMetrics() via the capability registry and
    // written to energy_snapshots with source = 'wolffie-core'.
    this._lastData = { ...m, inverterMode };
    await this.storeSnapshot(m, gridPowerDB);

    this.lastCollectionTime = new Date();
    this.lastError          = null;
    this.consecutiveErrors  = 0;
    console.log(
      `   • ${PREFIX} - ${localTimestamp()}` +
      ` SOC=${Math.round(m.battery.soc)}%` +
      ` Battery=${m.battery.power}W` +
      ` Grid(raw)=${m.grid.total_active_power}W` +
      ` Grid(DB)=${gridPowerDB}W` +
      ` Mode=${inverterMode?.mode ?? '?'}`
    );
    return true;
  }

  async storeSnapshot(m, gridPowerDB) {
    // All energy_snapshots rows use local time (CET/CEST without offset marker)
    // to match alphaess-cloud / homewizard / wolffie-core / solaredge-modbus.
    // Earlier versions used datetime('now') which SQLite interprets as UTC.
    const localNow = localTimestamp();

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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        localNow,                       // timestamp
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

        // ── NOT OWNED → NULL — derived by wolffie-core ────────────────────────
        null,                           // load_power
        null,                           // load_energy_today

        // ── OWNED ─────────────────────────────────────────────────────────────
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

  /** Last successful fetchAll() result for capability reads in index.js. */
  getLastSnapshot() {
    return this._lastData;
  }
}

export default new AlphaModbusCollector();