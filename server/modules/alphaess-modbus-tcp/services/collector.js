// modules/alphaess-modbus-tcp/services/collector.js
import db from '../../../core/database.js';
import api from './api.js';
import settingsService from '../../../core/system/services/settingsService.js';

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
      // Gebruik de centrale API service (die nu de 400ms delay en checkStatus beheert)
      await api.connect(config.host, config.port, config.unit_id);
      const m = await api.fetchAll();

      // --- 🧮 BEREKENINGEN VOOR DE BALANS (SMILE G3-T10) ---
      
      // 1. Grid Vermogen voor Dashboard (Inverteren: Import (+), Export (-))
      const gridPowerDB = m.grid.total_active_power * -1;
      
      // 2. Berekend Huisverbruik (load_power in Watt)
      // Formule: Solar + Batterij (Ontladen is +) - Grid (Export is +)
      const loadPower = Math.max(0, m.solar.total_power + m.battery.power - m.grid.total_active_power);

      // 3. Berekend Huisverbruik Totaal Vandaag (load_energy_today in kWh)
      // Formule: Solar Vandaag + (Grid Import - Grid Export) + (Ontladen Vandaag - Laden Vandaag)
      const loadEnergyToday = Math.max(0, 
        m.solar.energy_today + 
        (m.grid.import_today - m.grid.export_today) + 
        (m.battery.discharge_today - m.battery.charge_today)
      );

      // 4. Geschatte stroom per fase (aangezien de T10 registers vaak 0 tonen)
      const estCurrent = m.grid.l1_voltage > 0 ? (loadPower / 3) / m.grid.l1_voltage : 0;

      // --- 📝 DATABASE OPSLAG (25 KOLOMMEN TOTAAL) ---
      const query = `
        INSERT INTO energy_snapshots (
          timestamp, source, device_id, 
          solar_power, solar_energy_today, 
          battery_power, battery_soc, battery_voltage, battery_current, battery_temp, 
          battery_charge_today, battery_discharge_today,
          grid_power, grid_voltage_l1, grid_voltage_l2, grid_voltage_l3, 
          grid_current_l1, grid_current_l2, grid_current_l3,
          grid_frequency, grid_energy_import_today, grid_energy_export_today,
          load_power, load_energy_today, inverter_temp
        ) VALUES (NOW(3), 'alphaess-modbus-tcp', 'alpha-smile-g3-t10', ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

      // VALS ARRAY MOET EXACT 22 ELEMENTEN BEVATTEN (3 statische waarden + 22 placeholders)
      const vals = [
        m.solar.total_power, m.solar.energy_today,              // 1, 2
        m.battery.power, m.battery.soc, 0,                      // 3, 4, 5 (Voltage: 0)
        0, 0,                                                   // 6, 7 (Current, Temp: 0)
        m.battery.charge_today, m.battery.discharge_today,      // 8, 9
        gridPowerDB,                                            // 10
        m.grid.l1_voltage, 0, 0,                                // 11, 12, 13 (L2, L3: 0)
        estCurrent, estCurrent, estCurrent,                     // 14, 15, 16
        0, m.grid.import_today, m.grid.export_today,            // 17, 18, 19 (Freq: 0)
        loadPower, loadEnergyToday, m.system.inverter_temp      // 20, 21, 22
      ];

      await db.pool.query(query, vals);
      console.error(`\x1b[37m   • AlphaESS ModBus TCP [${new Date().toISOString()}] - collected \x1b[37m`);
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
    return { lastCollection: this.lastCollection, lastError: this.lastError, healthy: this.consecutiveErrors < 5 };
  }
}

export default new AlphaModbusCollector();