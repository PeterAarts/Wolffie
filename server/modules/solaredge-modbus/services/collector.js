// modules/solaredge-modbus/services/collector.js
import db from '../../../core/database.js';
import api from './api.js';

/**
 * Wolffie SolarEdge ModBus Collector - v1.2 (Production)
 * Bridge between SolarEdge SunSpec inverter and energy_snapshots SQL table.
 * Fully aligned with the 30-column schema.
 *
 * Solar-only device: battery/grid columns stored as 0 — AlphaESS is truth source.
 * solar_energy_today derived via midnight-baseline delta on SunSpec energy_total (Wh cumulative).
 */
class SolarEdgeCollector {
  constructor() {
    this.config             = null; // injected by index.js after initialize()
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

  async _writeDailyBaseline(pvTotalKwh) {
    const today = new Date().toISOString().slice(0, 10);
    const entries = [
      ['daily_baseline_date',     today,                    'string'],
      ['daily_baseline_pv_total', pvTotalKwh.toFixed(4),   'number'],
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
      console.error('[SolarEdge] Failed to write daily baseline:', err.message);
    }
  }

  // ─── Collect ───────────────────────────────────────────────────────────────

  async collect() {
    try {
      if (!this.config?.host) return true; // config not injected yet — skip, not an error

      const config = this.config;

      if (config.enabled === false || config.enabled === 'false') {
        return true; // disabled — not an error
      }

      const host = config.host || config.ip_address;
      const port = Number(config.port);

      if (!host || !port) {
        console.warn('\x1b[91m   • SolarEdge: Connection parameters missing in database\x1b[37m');
        return false;
      }

      await api.connect(config);

      // Read SunSpec inverter block: power_ac, voltage_ln, energy_total, temp_sink, status
      const data = await api.readBlock('inverter');

      // Compute solar_energy_today via baseline delta
      const pvTotalKwh = (data.energy_total ?? 0) / 1000; // Wh → kWh
      let baseline = await this._readDailyBaseline();
      if (baseline === null) {
        await this._writeDailyBaseline(pvTotalKwh);
        baseline = pvTotalKwh;
      }
      const solarEnergyToday = Math.max(0,
        Math.round((pvTotalKwh - baseline) * 100) / 100
      );

      await this.storeSnapshot(data, solarEnergyToday);

      this.lastCollectionTime = new Date();
      this.lastError          = null;
      this.consecutiveErrors  = 0;

      const ts = new Date().toISOString();
      console.log(`\x1b[32m   • SolarEdge ModBus – ${ts}\x1b[37m  Power:  Solar=${solarPower}W  Temp=${(data.temp_sink !== null && data.temp_sink > -200 && data.temp_sink < 200) ? data.temp_sink.toFixed(1) : 'n/a'}°C  Voltage=${(data.voltage_ln > 0 && data.voltage_ln < 300) ? data.voltage_ln.toFixed(1) : 'n/a'}V`);
      return true;

    } catch (error) {
      this.lastError = error.message;
      this.consecutiveErrors++;
      try { api.client.close(); } catch (_) {}
      console.error(`\x1b[31m   • SolarEdge Collector Error: ${error.message}\x1b[37m`);
      return false;
    }
  }

  // ─── Store ─────────────────────────────────────────────────────────────────

  async storeSnapshot(data, solarEnergyToday) {
    const solarPower = data.power_ac > 0 ? Math.round(data.power_ac) : 0;

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
        // 2.  source
        'solaredge-modbus',
        // 3.  device_id
        'solaredge-se',
        // 4.  solar_power
        solarPower,
        // 5.  solar_energy_today
        solarEnergyToday,
        // 6.  battery_power         — n/a, solar-only device
        0,
        // 7.  battery_soc
        0,
        // 8.  battery_voltage
        0.0,
        // 9.  battery_current
        0.0,
        // 10. battery_temp
        0.0,
        // 11. grid_power            — n/a, solar-only device
        0,
        // 12. grid_voltage_l1       — AC output voltage from SunSpec; clamp sentinel (0xFFFF×scale = 6553.5)
        (data.voltage_ln !== null && data.voltage_ln > 0 && data.voltage_ln < 300) ? data.voltage_ln : null,
        // 13. grid_voltage_l2
        0.0,
        // 14. grid_voltage_l3
        0.0,
        // 15. grid_current_l1
        0.0,
        // 16. grid_current_l2
        0.0,
        // 17. grid_current_l3
        0.0,
        // 18. grid_frequency
        50.0,
        // 19. grid_energy_import_today — n/a
        0.0,
        // 20. grid_energy_export_today — n/a
        0.0,
        // 21. load_power              — n/a, AlphaESS is truth source
        0,
        // 22. load_energy_today
        0.0,
        // 23. inverter_temp  — clamp: 0x8000 (-32768) = not implemented sentinel; valid range -40..120°C
        (data.temp_sink !== null && data.temp_sink > -200 && data.temp_sink < 200) ? data.temp_sink : 0.0,
        // 24. inverter_power          — equals solar output for SE
        solarPower,
        // 25. battery_charge_today    — n/a
        0.0,
        // 26. battery_discharge_today — n/a
        0.0,
        // 27. trees_equivalent
        0.0,
        // 28. co2_offset_kg
        0.0,
      ]
    );
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  getStatus() {
    return {
      lastCollection:    this.lastCollectionTime,
      lastError:         this.lastError,
      consecutiveErrors: this.consecutiveErrors,
    };
  }
}

export default new SolarEdgeCollector();