import api from './api.js';
import settingsService from '../../../core/system/services/settingsService.js';
import aggregatorService from '../../../core/system/services/aggregatorService.js';

class SolarEdgeCollector {
  constructor() {
    this.lastData = null;
    this.lastRun = null;
    this.lastError = null;
    this.consecutiveErrors = 0;
  }

  async collect() {
    try {
      // Ensure this category matches your database 'category' column exactly
      const config = await settingsService.getCategory('solaredge-modbus'); 
      
      if (!config || config.enabled === false) {
        console.log(' -  SolarEdge: Module disabled or not configured');
        return false;
      }

      // Check for required fields before attempting connection
      if (!(config.host || config.ip_address) || !config.port) {
        console.warn('\x1b[91m   • SolarEdge: Connection parameters missing in database \x1b[37m');
        return false;
      }
      // Normalize data for Wolffie's standard database format
      const normalized = {
        timestamp: new Date(),
        module: 'solaredge-modbus',
        power_pv: data.power_ac > 0 ? data.power_ac : 0, // Simplified for single inverter
        voltage_ac: data.voltage_ln,
        energy_total: data.energy_total,
        inverter_status: data.status,
        temperature: data.temp_sink
      };

      await aggregatorService.saveSnapshot(normalized);
      
      this.lastData = normalized;
      this.lastRun = new Date();
      this.consecutiveErrors = 0;
      return true;

    } catch (error) {
      this.lastError = error.message;
      this.consecutiveErrors++;
      console.error(`\x1b[91m   • SolarEdge Collector Error: ${error.message}`, '\x1b[37m');
      return false;
    }
  }

  getStatus() {
    return {
      lastRun: this.lastRun,
      lastError: this.lastError,
      consecutiveErrors: this.consecutiveErrors
    };
  }
}

export default new SolarEdgeCollector();