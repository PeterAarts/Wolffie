// modules/alphaess-modbus-tcp/services/collector.js
import db from '../../../core/database.js';
import api from './api.js';
import settingsService from '../../../core/system/services/settingsService.js';

/**
 * Wolffie AlphaESS ModBus Collector - v6.3 (Production)
 * Bridge between SMILE G3-T10 hardware and energy_snapshots SQL table.
 * Fully aligned with the 30-column schema provided.
 */
class AlphaModbusCollector {
  constructor() {
    this.lastCollection = null;
    this.lastError = null;
    this.consecutiveErrors = 0;
  }

  async collect() {
    try {
      const config = await settingsService.getModuleSettings('alphaess-modbus-tcp');
      if (!config || !config.enabled) return true;

      await api.connect(config.host, config.port, config.unit_id);
      
      // Fetch data using the Big-Endian corrected handlers in api.js
      const m = await api.fetchAll();

      // --- 🧮 BALANCING CALCULATIONS (G3-T10 AC-Coupled) ---
      
      // 1. Grid Power (Dashboard Standard: Import +, Export -)
      const gridPowerDB = m.grid.total_active_power * -1;
      
      // 2. Calculated House Load
      // Formula: Solar + Battery Flow (pos=discharge) + Grid Flow (pos=import)
      const loadPower = Math.max(0, m.solar.total_power + m.battery.power + gridPowerDB);

      // 3. Today's Totals (kWh)
      const loadEnergyToday = Math.max(0, 
        m.solar.energy_today + 
        (m.grid.import_today - m.grid.export_today) + 
        (m.battery.discharge_today - m.battery.charge_today)
      );

      // --- 📝 DATABASE STORAGE (28 columns specified, excluding auto id and created_at) ---
      // We have 3 fixed values (NOW, source, device_id) and 25 ? placeholders. Total = 28 columns.
      const query = `
        INSERT INTO energy_snapshots (
          timestamp, source, device_id, 
          solar_power, solar_energy_today, 
          battery_power, battery_soc, battery_voltage, battery_current, battery_temp, 
          grid_power, grid_voltage_l1, grid_voltage_l2, grid_voltage_l3, 
          grid_current_l1, grid_current_l2, grid_current_l3,
          grid_frequency, grid_energy_import_today, grid_energy_export_today,
          load_power, load_energy_today, inverter_temp,
          inverter_power, battery_charge_today, battery_discharge_today,
          trees_equivalent, co2_offset_kg
        ) VALUES (NOW(3), 'alphaess-modbus-tcp', 'alpha-smile-g3-t10', ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

      // VALS array matches exactly 25 placeholders (?)
      const vals = [
        m.solar.total_power, m.solar.energy_today,                      // 1, 2
        m.battery.power, Math.round(m.battery.soc), 0.0,                // 3, 4, 5 (Voltage: 0)
        0.0, 0.0,                                                       // 6, 7 (Current, Temp: 0)
        gridPowerDB, m.grid.l1_voltage, 0.0, 0.0,                       // 8, 9, 10, 11
        0.0, 0.0, 0.0,                                                  // 12, 13, 14 (Grid Currents)
        50.00, m.grid.import_today, m.grid.export_today,                // 15, 16, 17
        Math.round(loadPower), loadEnergyToday,                         // 18, 19
        m.system.inverter_temp,                                         // 20
        0,                                                              // 21 (Inverter Power)
        m.battery.charge_today, m.battery.discharge_today,              // 22, 23
        0.0, 0.0                                                        // 24, 25 (Trees/CO2)
      ];

      await db.pool.query(query, vals);
      
      this.lastCollection = new Date();
      this.consecutiveErrors = 0;
      this.lastError = null;
      return true;

    } catch (e) {
      console.error(`\x1b[31m   • AlphaESS ModBus Collector Error: ${e.message} \x1b[37m`);
      this.lastError = e.message;
      this.consecutiveErrors++;
      return false;
    }
  }

  getStatus() {
    return { 
        lastCollection: this.lastCollection, 
        lastError: this.lastError, 
        healthy: this.consecutiveErrors < 5 
    };
  }
}

export default new AlphaModbusCollector();