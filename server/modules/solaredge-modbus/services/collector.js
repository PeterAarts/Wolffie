// modules/solaredge-modbus/services/collector.js
import db from '../../../core/database.js';
import api from './api.js';
import curtailState from './curtailState.js';
import { localTimestamp } from '../../../core/utils/localTimestamp.js';
import { padName } from '../../../core/utils/logger.js';
const PREFIX = padName('Solar-Edge ModBus');

/**
 * Wolffie SolarEdge ModBus Collector - v2.7
 * Bridge between SolarEdge SE3000H SunSpec inverter and energy_snapshots table.
 *
 * Design principles:
 *
 *   1. FRESH connection each cycle — connect, read, close.
 *      The SolarEdge inverter silently drops persistent TCP connections after
 *      ~30-60 seconds, causing the socket to appear open on the Node side but
 *      return sentinel values (0xFFFE etc.) instead of real data.
 *      Connecting fresh each cycle avoids this entirely, matching the pattern
 *      used by the AlphaESS Modbus collector which is known stable.
 *
 *   2. NULL for unowned fields, not 0.
 *      Prevents AVG(battery_soc) dilution in aggregation queries.
 *
 *   3. Status=7 (Fault) is NOT an error — SE3000H firmware quirk.
 *      Status=null means the inverter returned a sentinel (sleeping/starting up).
 *
 *   4. Daily energy via midnight-baseline delta on cumulative energy_total (Wh).
 *      Baseline only written when energy_total is a real non-null value.
 *      Baseline date uses LOCAL time so the reset happens at local midnight
 *      (matches all other collectors).
 *
 *   5. All energy_snapshots rows use local time (CET/CEST without offset marker)
 *      to match alphaess-cloud / homewizard / wolffie-core.
 *
 *   6. abort() — optional hang-recovery hook for CollectorManager.
 *      If a cycle's connect()/fetchAll() chain hangs (e.g. the inverter
 *      accepts a TCP handshake but never replies), CollectorManager's
 *      per-cycle deadline stops waiting on it and calls abort() here so
 *      the stuck socket gets force-closed immediately instead of leaking
 *      until the OS notices. Safe for this module specifically because
 *      every cycle already opens its own fresh connection (point 1 above).
 *      An abandoned curtail heartbeat is also safe — see point 7.
 *
 *   7. CURTAILMENT HEARTBEAT (new in v2.7).
 *      The collector is the single writer of the inverter's dynamic power
 *      limit (0xF322). Capability handlers only record intent in
 *      curtailState; this is where it reaches hardware, inside the
 *      connection this collector already owns.
 *
 *      Why a heartbeat rather than a one-shot write: 0xF322 is guarded by
 *      the inverter's own watchdog (0xF310 Command Timeout = 380s,
 *      0xF312 Fall-back = 100%). If the inverter stops receiving dynamic
 *      commands it restores full production by itself. That is the
 *      fail-safe — if Wolffie crashes while solar is curtailed, the
 *      inverter recovers without us. The cost is that we must keep writing
 *      for as long as we want the limit to hold.
 *
 *      A 20s cycle against a 380s timeout leaves 19 consecutive failed
 *      cycles of slack, so transient Modbus errors never cause flapping.
 *
 *      The write is placed AFTER fetchAll() and BEFORE disconnect(), so a
 *      curtail failure can never prevent a data collection — monitoring
 *      keeps working even when control does not.
 */
class SolarEdgeCollector {
  constructor() {
    this.config             = null;
    this.lastData           = null;
    this.lastCollectionTime = null;
    this.lastError          = null;
    this.consecutiveErrors  = 0;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Local YYYY-MM-DD — used for daily baseline keying so the reset is at
   *  local midnight, not UTC midnight. */
  _localDate() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // ─── Daily Baseline ────────────────────────────────────────────────────────

  async _readDailyBaseline() {
    try {
      const [rows] = await db.pool.query(
        `SELECT setting_key, setting_value
           FROM system_settings
          WHERE category = 'solaredge-modbus'
            AND setting_key IN ('daily_baseline_date', 'daily_baseline_pv_total')`
      );
      if (!rows.length) return null;
      const m     = Object.fromEntries(rows.map(r => [r.setting_key, r.setting_value]));
      const today = this._localDate();
      if (m.daily_baseline_date !== today) return null; // stale — new day
      return parseFloat(m.daily_baseline_pv_total ?? 0);
    } catch (err) {
      console.warn(`     ${PREFIX} Could not read daily baseline:`, err.message);
      return null;
    }
  }

  async _writeDailyBaseline(pvTotalWh) {
    const today      = this._localDate();
    const pvTotalKwh = pvTotalWh / 1000;
    const entries = [
      ['daily_baseline_date',     today,                  'string'],
      ['daily_baseline_pv_total', pvTotalKwh.toFixed(4),  'number'],
    ];
    try {
      for (const [key, value, type] of entries) {
        await db.pool.query(
          `INSERT OR REPLACE INTO system_settings (category, setting_key, setting_value, value_type, description)
               VALUES ('solaredge-modbus', ?, ?, ?, ?)`,
          [key, value, type, `SolarEdge daily baseline — ${key}`]
        );
      }
    } catch (err) {
      console.warn(`${PREFIX} baseline write failed (will retry next cycle):`, err.message);
      // Non-fatal — collector continues even if baseline write fails
    }
  }

  // ─── Curtailment ───────────────────────────────────────────────────────────

  /**
   * Reconcile the inverter's dynamic power limit with curtailState.
   *
   * Called once per cycle while the connection is open. Never throws — a
   * control failure must not abort a data collection. Failures are recorded
   * in curtailState.lastError and logged loudly, because this path fires so
   * rarely that a silent failure would go unnoticed for months (which is
   * exactly what happened to the previous implementation).
   */
  async _applyCurtailment() {
    try {
      // Always refresh the hardware facts. The UI shows these, and reading
      // them each cycle means the status reflects the inverter rather than
      // Wolffie's assumptions about it.
      const pc = await api.readPowerControl();

      curtailState.baseLimitW            = pc.baseLimitW;
      curtailState.commandTimeoutS       = pc.commandTimeoutS;
      curtailState.fallbackPct           = pc.fallbackPct;
      curtailState.dynamicControlEnabled = pc.dynamicControlEnabled;
      curtailState.verifiedPct           = pc.currentPct;

      // Expire a timed request before deciding what to write.
      if (curtailState.isExpired()) {
        console.log(`   • ${PREFIX} - Curtail window elapsed — restoring 100%`);
        curtailState.release();
      }

      // Nothing wanted and nothing to undo → leave the inverter alone.
      if (!curtailState.active && !curtailState.needsRestore) return;

      // ── Guard: dynamic control must be armed ─────────────────────────────
      // 0xF300 was 1 on this hardware at the time of writing. If it is ever
      // 0, a write to 0xF322 would be accepted and stored but never acted
      // on — the failure mode that cost six months last time. Refuse rather
      // than report success.
      if (curtailState.active && !pc.dynamicControlEnabled) {
        throw new Error(
          'F300 Enable Dynamic Power Control reads 0 — the inverter will store ' +
          'a limit but not act on it. Refusing to report success.'
        );
      }

      if (!(pc.baseLimitW > 0)) {
        throw new Error(`F30C base limit reads ${pc.baseLimitW} — cannot compute a percentage.`);
      }

      // Recompute the percentage against the live base rather than the base
      // captured when the request was made, in case F30C changed.
      const targetPct = curtailState.active
        ? Math.max(0, Math.min(100, (curtailState.targetWatts / pc.baseLimitW) * 100))
        : 100;

      const confirmed = await api.setDynamicActivePowerLimit(targetPct);

      curtailState.targetPct     = curtailState.active ? targetPct : null;
      curtailState.verifiedPct   = confirmed;
      curtailState.lastAppliedAt = Date.now();
      curtailState.lastError     = null;

      if (curtailState.active) {
        // Only log a transition or a recovery, not every 20s heartbeat —
        // otherwise a two-hour curtailment writes 360 identical log lines.
        if (curtailState.failedWrites > 0) {
          console.log(`   • ${PREFIX} - Curtail heartbeat recovered at ${confirmed.toFixed(2)}%`);
        }
        curtailState.failedWrites = 0;
      } else {
        curtailState.needsRestore = false;
        curtailState.failedWrites = 0;
        console.log(`   • ${PREFIX} - Solar restored to 100% (confirmed ${confirmed.toFixed(2)}%)`);
      }

    } catch (err) {
      curtailState.failedWrites++;
      curtailState.lastError = err.message;

      const timeout = curtailState.commandTimeoutS ?? 380;
      const interval = (this.config?.poll_interval ?? 20000) / 1000;
      const cyclesLeft = Math.max(0, Math.floor(timeout / interval) - curtailState.failedWrites);

      console.error(
        `\x1b[31m   • ${PREFIX} - Curtail apply FAILED (${curtailState.failedWrites}x): ` +
        `${err.message}\x1b[37m`
      );

      if (curtailState.active) {
        console.error(
          `\x1b[31m     ↳ inverter watchdog will restore production in ~${cyclesLeft} ` +
          `more failed cycles (F310 = ${timeout}s)\x1b[37m`
        );
      } else if (curtailState.needsRestore) {
        console.error(
          `\x1b[31m     ↳ could not confirm restore to 100% — verify in the SolarEdge app\x1b[37m`
        );
      }
    }
  }

  // ─── Collect ───────────────────────────────────────────────────────────────

  async collect() {
    if (!this.config?.host) return true;
    if (this.config.enabled === false || this.config.enabled === 'false') return true;

    try {
      // ── Connect fresh each cycle ───────────────────────────────────────────
      // SolarEdge silently drops persistent TCP connections — always connect
      // fresh and close after reading to guarantee clean register reads.
      await api.connect(this.config);

      // ── Fetch ──────────────────────────────────────────────────────────────
      const data = await api.fetchAll();

      // ── Curtailment heartbeat ──────────────────────────────────────────────
      // Inside the connection we already hold. Deliberately after fetchAll()
      // so a control failure can never cost us a data point, and never
      // throws — it records its own errors.
      await this._applyCurtailment();

      // ── Always disconnect after reading ────────────────────────────────────
      await api.disconnect();

      // ── Daily energy delta ─────────────────────────────────────────────────
      let solarEnergyToday = 0;

      if (data.energy_total !== null) {
        const pvTotalWh  = data.energy_total;
        const pvTotalKwh = pvTotalWh / 1000;

        let baselineKwh = await this._readDailyBaseline();
        if (baselineKwh === null) {
          await this._writeDailyBaseline(pvTotalWh);
          baselineKwh = pvTotalKwh;
        }

        solarEnergyToday = Math.max(0,
          Math.round((pvTotalKwh - baselineKwh) * 100) / 100
        );
      }

      // ── Update lastData for capability registry ────────────────────────────
      this.lastData = { ...data, solar_energy_today: solarEnergyToday };

      // ── Store ──────────────────────────────────────────────────────────────
      await this.storeSnapshot(data, solarEnergyToday);

      this.lastCollectionTime = new Date();
      this.lastError          = null;
      this.consecutiveErrors  = 0;

      const solarW  = Math.max(0, Math.round(data.power_ac ?? 0));
      const tempStr = (data.temp_sink !== null && data.temp_sink > -200 && data.temp_sink < 200)
        ? `${data.temp_sink.toFixed(1)}°C` : 'n/a';
      const voltStr = (data.voltage_ln !== null && data.voltage_ln > 0 && data.voltage_ln < 300)
        ? `${data.voltage_ln.toFixed(1)}V`  : 'n/a';
      const statusStr = data.status === null
        ? '  Status=Not ready'
        : (data.status !== 4 ? `  Status=${data.status_label}` : '');

      // Only appended while a limit is actually in force, so normal
      // operation logs exactly as before.
      const curtailStr = curtailState.active
        ? `  Curtail=${Math.round(curtailState.targetWatts)}W` +
          `(${(curtailState.verifiedPct ?? 0).toFixed(1)}%)` +
          (curtailState.failedWrites > 0 ? ' ⚠' : '')
        : '';

      console.log(
        `   • ${PREFIX} – ${localTimestamp()}` +
        ` Solar=${solarW}W` +
        ` Today=${solarEnergyToday}kWh` +
        ` Temp=${tempStr}` +
        ` Voltage=${voltStr}` +
        statusStr +
        curtailStr
      );

      return true;

    } catch (error) {
      this.lastError = error.message;
      this.consecutiveErrors++;

      // Ensure connection is closed on error so next cycle starts clean
      await api.disconnect();

      console.error(`\x1b[31m   • ${PREFIX} Error: ${error.message}\x1b[37m`);
      return false;
    }
  }

  /**
   * Force-abort whatever connection api.js currently has in flight.
   * See the class-level doc comment (point 6) for why this is safe here.
   * Delegates straight to api.abort() — collector.js owns the polling
   * cycle, api.js owns the actual socket.
   */
  async abort() {
    return await api.abort();
  }

  // ─── Store ─────────────────────────────────────────────────────────────────

  async storeSnapshot(data, solarEnergyToday) {
    const solarPower = Math.max(0, Math.round(data.power_ac ?? 0));

    const gridVoltL1 = (data.voltage_ln !== null && data.voltage_ln > 80 && data.voltage_ln < 300)
      ? data.voltage_ln : null;

    const invTemp = (data.temp_sink !== null && data.temp_sink > -200 && data.temp_sink < 200)
      ? data.temp_sink : null;

    // All energy_snapshots rows use local time (CET/CEST without offset marker)
    // to match alphaess-cloud / homewizard / wolffie-core. Earlier versions
    // used datetime('now') which SQLite interprets as UTC.
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
        localNow,
        'solaredge-modbus',
        'solaredge-se',
        solarPower,        // solar_power           W        OWNED
        solarEnergyToday,  // solar_energy_today    kWh      OWNED
        null,              // battery_power                  NOT OWNED
        null,              // battery_soc                    NOT OWNED
        null,              // battery_voltage                NOT OWNED
        null,              // battery_current                NOT OWNED
        null,              // battery_temp                   NOT OWNED
        null,              // grid_power                     NOT OWNED
        gridVoltL1,        // grid_voltage_l1       V        OWNED (AC bus)
        null,              // grid_voltage_l2                NOT OWNED
        null,              // grid_voltage_l3                NOT OWNED
        null,              // grid_current_l1                NOT OWNED
        null,              // grid_current_l2                NOT OWNED
        null,              // grid_current_l3                NOT OWNED
        null,              // grid_frequency                 NOT OWNED
        null,              // grid_energy_import_today       NOT OWNED
        null,              // grid_energy_export_today       NOT OWNED
        null,              // load_power                     NOT OWNED
        null,              // load_energy_today              NOT OWNED
        invTemp,           // inverter_temp         °C       OWNED
        solarPower,        // inverter_power        W        OWNED
        null,              // battery_charge_today           NOT OWNED
        null,              // battery_discharge_today        NOT OWNED
        0.0,               // trees_equivalent
        0.0,               // co2_offset_kg
      ]
    );
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  getStatus() {
    return {
      lastCollection:    this.lastCollectionTime,
      lastError:         this.lastError,
      consecutiveErrors: this.consecutiveErrors,
      lastData:          this.lastData,
      curtail:           curtailState.snapshot(),
    };
  }
}

export default new SolarEdgeCollector();