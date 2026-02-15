// modules/alphaess-modbus-rs485/services/collector.js
import db from '../../../core/database.js';
import alphaAPI from './api.js';

class AlphaESSModbusCollector {
  constructor() {
    this.lastCollection = null;
    this.lastError = null;
    this.consecutiveErrors = 0;
  }

  async collect() {
    try {
      const data = await alphaAPI.getRealtimeData();
      const timestamp = new Date();

      await db.pool.query(
        `INSERT INTO energy_snapshots (timestamp, source, device_id, battery_soc, battery_power, solar_power, grid_power, load_power)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [timestamp, 'alphaess-modbus-rs485', 'inverter-rs485', data.soc, data.pbat, data.ppv, data.pgrid, data.pload]
      );

      this.lastCollection = timestamp;
      this.lastError = null;
      this.consecutiveErrors = 0;
      return true;
    } catch (error) {
      this.lastError = error.message;
      this.consecutiveErrors++;
      return false;
    }
  }

  getStatus() {
    return { lastCollection: this.lastCollection, lastError: this.lastError, consecutiveErrors: this.consecutiveErrors };
  }
}

export default new AlphaESSModbusCollector();