// modules/alphaess-modbus-tcp/services/collector.js
import db from '../../../core/database.js';
import api from './api.js';

/**
 * Wolffie AlphaESS ModBus Collector - v6.6 (Production)
 * Bridge between SMILE G3-T10 hardware and energy_snapshots SQL table.
 * Fully aligned with the 30-column schema and Cloud collector pattern.
 *
 * Config/connection is owned by index.js — collector uses api directly.
 */
class AlphaModbusCollector {
  constructor() {
    this.lastCollectionTime = null;
    this.lastError          = null;
    this.consecutiveErrors  = 0;
    this.config             = null; // set by index.js after initialize()
  }

  async collect() {
    try {
      // Config injected by index.js — if missing, module isn't ready yet
      if (!this.config?.host) {
        console.warn(`   • AlphaESS ModBus: no config available yet, skipping`);
        return true;
      }

      // Force fresh connection each cycle — avoids stale reads from lingering open connection
      try { await api.client.close(); } catch (_) {}
      api.isConnected = false;
      await api.connect(this.config.host, this.config.port, this.config.unit_id);

      const m = await api.fetchAll();

      // ── Grid power: source determined by grid_power_source setting ───────────
      // 'internal'      → AlphaESS register 0x0021 (default, works for all)
      // 'homewizard-p1' → latest grid_power from energy_snapshots (HWE-P1)
      // 'none'          → null (user has no grid meter)
      const gridPowerSource = this.config?.grid_power_source ?? 'internal';
      let gridPowerDB = null;

      if (gridPowerSource === 'internal') {
        // sign: AlphaESS register + = export, - = import → flip to + = import
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
            // P1 data not available yet — fall back to internal
            gridPowerDB = m.grid.total_active_power * -1;
            this.log('warn', 'grid_power_source=homewizard-p1 but no P1 snapshot found, falling back to internal register');
          }
        } catch (err) {
          gridPowerDB = m.grid.total_active_power * -1;
          this.log('warn', `P1 grid power query failed: ${err.message}, falling back to internal register`);
        }
      }
      // gridPowerSource === 'none' → gridPowerDB stays null

      // House load: Solar + Battery (pos=discharge) + Grid (pos=import)
      const loadPower = Math.max(0,
        m.solar.total_power + m.battery.power + gridPowerDB
      );

      // Load energy today derived from individual today counters
      const loadEnergyToday = m.home?.energy_today ?? Math.max(0,
        m.solar.energy_today +
        (m.grid.import_today - m.grid.export_today) +
        (m.battery.discharge_today - m.battery.charge_today)
      );

      await this.storeSnapshot(m, gridPowerDB, loadPower, loadEnergyToday);

      this.lastCollectionTime = new Date();
      this.lastError          = null;
      this.consecutiveErrors  = 0;
      console.log(`   • AlphaESS ModBus - ${new Date().toISOString()} SOC=${Math.round(m.battery.soc)}%  Solar=${m.solar.total_power}W  Battery=${m.battery.power}W  Grid(raw)=${m.grid.total_active_power}W  Grid(DB)=${gridPowerDB}W  Load=${Math.round(loadPower)}W`);
      return true;

    } catch (e) {
      console.error(`\x1b[31m   • AlphaESS ModBus Collector Error: ${e.message}\x1b[37m`);
      this.lastError = e.message;
      this.consecutiveErrors++;
      try { api.client.close(); } catch (_) {}
      return false;
    }
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
        // 2.  source
        'alphaess-modbus-tcp',
        // 3.  device_id
        'alpha-smile-g3-t10',
        // 4.  solar_power
        m.solar.total_power,
        // 5.  solar_energy_today
        m.solar.energy_today,
        // 6.  battery_power
        m.battery.power,
        // 7.  battery_soc
        Math.round(m.battery.soc),
        // 8.  battery_voltage        — not available via ModBus TCP on G3-T10
        0.0,
        // 9.  battery_current        — not available via ModBus TCP on G3-T10
        0.0,
        // 10. battery_temp           — not available via ModBus TCP on G3-T10
        0.0,
        // 11. grid_power
        gridPowerDB,
        // 12. grid_voltage_l1
        m.grid.l1_voltage,
        // 13. grid_voltage_l2        — single-phase meter on G3-T10
        0.0,
        // 14. grid_voltage_l3
        0.0,
        // 15. grid_current_l1        — not exposed via ModBus TCP
        0.0,
        // 16. grid_current_l2
        0.0,
        // 17. grid_current_l3
        0.0,
        // 18. grid_frequency         — from inverter freq register (0x041C)
        m.system.inv_freq ?? 50.0,
        // 19. grid_energy_import_today
        m.grid.import_today,
        // 20. grid_energy_export_today
        m.grid.export_today,
        // 21. load_power
        Math.round(loadPower),
        // 22. load_energy_today
        loadEnergyToday,
        // 23. inverter_temp
        m.system.inverter_temp,
        // 24. inverter_power         — equals solar output on G3-T10
        m.solar.total_power,
        // 25. battery_charge_today
        m.battery.charge_today,
        // 26. battery_discharge_today
        m.battery.discharge_today,
        // 27. trees_equivalent
        0.0,
        // 28. co2_offset_kg
        0.0,
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