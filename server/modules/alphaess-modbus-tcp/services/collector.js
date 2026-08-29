// modules/alphaess-modbus-tcp/services/collector.js
import db from '../../../core/database.js';
import api from './api.js';
import capabilityRegistry from '../../../core/capabilityRegistry.js';
import alertService from '../../../core/system/services/alertService.js';
import eventService from '../../../core/system/services/eventService.js';
import { localTimestamp } from '../../../core/utils/localTimestamp.js';
import { padName } from '../../../core/utils/logger.js';
const PREFIX = padName('AlphaESS ModBus');

/**
 * Wolffie AlphaESS ModBus Collector - v6.16
 * Bridge between SMILE G3-T10 hardware and energy_snapshots SQL table.
 * Fully aligned with the 30-column schema and Cloud collector pattern.
 *
 * Config/connection is owned by index.js — collector uses api directly.
 *
 * v6.16: battery_voltage, battery_current and battery_temp are now STORED.
 *   Registers 0x0100 / 0x0101 / 0x0110 were never read before v1.1.7 of api.js —
 *   the previous header comment claiming they are "not exposed via TCP" was wrong.
 *   battery_current is signed: negative = charging (hardware-verified 2026-08-25).
 *   battery_temp holds the MAX cell temperature, not an average — the peak is what
 *   drives degradation, and averaging min/max would hide it. Any aggregation over
 *   this column must preserve MAX rather than AVG or the long-term signal is lost.
 *   battery_soc is no longer rounded — the register gives 0.1 % resolution.
 *   inverter_power now comes from 0x040C (Inverter_Power_Total) instead of
 *   m.solar.total_power, which is structurally 0 on this AC-coupled install.
 *
 * v6.15: grid_power_source uses capability registry for external reads.
 *   'internal' = AlphaESS own register, anything else = grid:read capability.
 *   No hardcoded module names — registry routes to highest-priority provider.
 *   Legacy values ('p1-meter', 'homewizard-p1') handled as external.
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
 *   battery_power, battery_soc, battery_voltage, battery_current, battery_temp,
 *   grid_power, grid_voltage_l1, grid_frequency,
 *   grid_energy_import_today, grid_energy_export_today,
 *   inverter_temp, inverter_power,
 *   battery_charge_today, battery_discharge_today
 *
 * Fields deliberately NOT stored by this module → NULL:
 *   solar_power, solar_energy_today   — SolarEdge is authoritative source
 *   load_power, load_energy_today     — derived by wolffie-core (collectorManager)
 *   grid_voltage_l2/l3                — available at 0x0015/0x0016, but HomeWizard
 *                                       already owns the grid columns
 *   grid_current_l1/l2/l3             — AlphaESS CTs report MAGNITUDE ONLY (unsigned).
 *                                       Verified 2026-08-25: 232x1.8 + 230x1.9 +
 *                                       235x2.2 = 1372 VA against a reported
 *                                       grid_power of 3 W. Storing them would put
 *                                       unsigned magnitudes in the same column where
 *                                       HomeWizard writes correctly signed values.
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
    // 'internal' = use AlphaESS's own grid meter register
    // 'external' = use the grid:read capability from the registry (e.g. P1 meter)
    // Any unrecognised value (legacy 'p1-meter', 'homewizard-p1') → treat as external
    const gridPowerSource = this.config?.grid_power_source ?? 'internal';
    let gridPowerDB = null;

    if (gridPowerSource === 'internal') {
      // AlphaESS register convention: positive = importing, negative = exporting.
      // No inversion needed — store as-is.
      gridPowerDB = m.grid.total_active_power;
    } else {
      // External: use grid:read capability from the registry.
      // The registry routes to the highest-priority provider automatically.
      try {
        const gridHandler = capabilityRegistry.get('grid:read');
        if (gridHandler) {
          const gridData = await gridHandler({});
          gridPowerDB = gridData.power ?? null;
        }
      } catch (err) {
        console.warn(`   • ${PREFIX} - external grid:read failed: ${err.message}`);
      }
      // Fallback to internal register if external returned nothing
      if (gridPowerDB === null) {
        gridPowerDB = m.grid.total_active_power;
        console.warn(`   • ${PREFIX} - grid:read capability unavailable, falling back to internal register`);
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

    // ── Pending dispatch — piggybacks on the already-open connection ──────────
    // api.runPendingDispatch() writes dispatch registers if a charge/discharge
    // session is active, or resets to auto if stopDispatch() was called.
    // No separate connection opened — uses the connection established above.
    try {
      const dispatched = await api.runPendingDispatch();
      if (dispatched) {
        const d = api.getDispatchStatus();
        console.log(`   • ${PREFIX} - Dispatch: ${d.status} [origin: ${d.origin}]`);
      }
      if (api.getDispatchStatus().status === 'stopping') {
        const result = api.checkStopConfirmation(m.battery.power, 100);
        if (result?.timedOut) {
          await alertService.write('hardware', 'alphaess-modbus-tcp', {
            type: 'dispatch_stop_unconfirmed', severity: 'error',
            message: 'Stop command sent but battery power did not settle within 5 minutes. Still retrying.',
            suggestion: 'Check the inverter directly — dispatch may still be active.',
            action: '',
          }, 5); // 5-minute dedup — re-fires every cycle until confirmed, so it can't go silently unnoticed
        }
      }
    } catch (dispErr) {
      console.warn(`   • ${PREFIX} - runPendingDispatch failed: ${dispErr.message}`);
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
        m.battery.soc,                  // battery_soc      0.1 % resolution — do NOT round
        m.battery.voltage,              // battery_voltage  0x0100
        m.battery.current,              // battery_current  0x0101, negative = charging
        m.battery.temp_max,             // battery_temp     0x0110, MAX cell temp (not avg)

        // ── OWNED ─────────────────────────────────────────────────────────────
        gridPowerDB,                    // grid_power
        m.grid.l1_voltage,              // grid_voltage_l1

        // ── DELIBERATELY NOT STORED → NULL (see header) ───────────────────────
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
        m.system.inverter_power,        // inverter_power  (0x040C — real AC output)
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