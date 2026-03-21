// modules/solaredge-modbus/services/collector.js
import db from '../../../core/database.js';
import api from './api.js';

/**
 * Wolffie SolarEdge ModBus Collector - v2.3
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
 */
class SolarEdgeCollector {
  constructor() {
    this.config             = null;
    this.lastData           = null;
    this.lastCollectionTime = null;
    this.lastError          = null;
    this.consecutiveErrors  = 0;
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
      const today = new Date().toISOString().slice(0, 10);
      if (m.daily_baseline_date !== today) return null; // stale — new day
      return parseFloat(m.daily_baseline_pv_total ?? 0);
    } catch (err) {
      console.warn('[SolarEdge] Could not read daily baseline:', err.message);
      return null;
    }
  }

  async _writeDailyBaseline(pvTotalWh) {
    const today      = new Date().toISOString().slice(0, 10);
    const pvTotalKwh = pvTotalWh / 1000;
    const entries = [
      ['daily_baseline_date',     today,                  'string'],
      ['daily_baseline_pv_total', pvTotalKwh.toFixed(4),  'number'],
    ];
    try {
      for (const [key, value, type] of entries) {
        await db.pool.query(
          `INSERT INTO system_settings (category, setting_key, setting_value, value_type, description)
               VALUES ('solaredge-modbus', ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
          [key, value, type, `SolarEdge daily baseline — ${key}`]
        );
      }
    } catch (err) {
      console.warn('[SolarEdge] baseline write failed (will retry next cycle):', err.message);
      // Non-fatal — collector continues even if baseline write fails
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

      console.log(
        `   • SolarEdge ModBus – ${new Date().toISOString()}` +
        `  Solar=${solarW}W` +
        `  Today=${solarEnergyToday}kWh` +
        `  Temp=${tempStr}` +
        `  Voltage=${voltStr}` +
        statusStr
      );

      return true;

    } catch (error) {
      this.lastError = error.message;
      this.consecutiveErrors++;

      // Ensure connection is closed on error so next cycle starts clean
      await api.disconnect();

      console.error(`\x1b[31m   • SolarEdge Collector Error: ${error.message}\x1b[37m`);
      return false;
    }
  }

  // ─── Store ─────────────────────────────────────────────────────────────────

  async storeSnapshot(data, solarEnergyToday) {
    const solarPower = Math.max(0, Math.round(data.power_ac ?? 0));

    const gridVoltL1 = (data.voltage_ln !== null && data.voltage_ln > 80 && data.voltage_ln < 300)
      ? data.voltage_ln : null;

    const invTemp = (data.temp_sink !== null && data.temp_sink > -200 && data.temp_sink < 200)
      ? data.temp_sink : null;

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
    };
  }
}

export default new SolarEdgeCollector();