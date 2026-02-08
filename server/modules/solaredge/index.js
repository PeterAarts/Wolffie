import ModbusRTU from 'modbus-serial';
import db from '../../core/database.js';

const client = new ModbusRTU();

export default {
  async initialize() {
    // Gebruik de IP uit je system_settings (category: 'solaredge')
    try {
      await client.connectTCP("192.168.1.160", { port: 502 });
      await client.setID(1);
      console.log('✅ SolarEdge: Connected via Modbus TCP');
    } catch (e) { console.error('❌ SolarEdge connection failed:', e.message); }
  },

  /**
   * Stelt het maximale vermogen in (0% tot 100%)
   * Register 0xF001 (Active Power Limit)
   */
  async setPowerLimit(percentage) {
    try {
      // Schrijf percentage (0-100) naar register 61441 (0xF001)
      await client.writeRegister(0xF001, percentage);
      // Soms is een 'Commit' nodig op 0xF100
      await client.writeRegister(0xF100, 1);
      console.log(`☀️ SolarEdge: Power limit set to ${percentage}%`);
      return true;
    } catch (e) {
      console.error('❌ SolarEdge write error:', e.message);
      return false;
    }
  }
};