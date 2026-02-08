import ModbusRTU from 'modbus-serial';
import db from '../../core/database.js';

const client = new ModbusRTU();

export default {
  // Dit object wordt door moduleLoader.js ingeladen
  async initialize() {
    console.log('🔌 AlphaESS Modbus: Initializing connection...');
    // IP en poort kunnen later uit je device_settings tabel komen
    try {
      await client.connectTCP("192.168.1.158", { port: 502 });
      await client.setID(85);
      console.log('✅ AlphaESS Modbus: Connected');
    } catch (e) {
      console.error('❌ AlphaESS Modbus Connection failed:', e.message);
    }
  },

  // De collect() methode die de collectorManager aanroept
  async collect() {
    try {
      // Voorbeeld: Lees SOC (Register 0x0102)
      const data = await client.readHoldingRegisters(0x0102, 1);
      const soc = data.data[0] / 10;
      
      // Sla op in de database via je bestaande flow
      // (Vergelijkbaar met hoe alphaess-cloud dat doet)
      return true;
    } catch (e) {
      this.lastError = e.message;
      return false;
    }
  },

  // STAP 3/4: De Schrijf-methode voor de Strategie
  async setGridCharge(enabled, powerWatts = 3000) {
    try {
      if (enabled) {
        // 1. Zet Dispatch Mode naar Grid Charge (bijv. register 0x0801)
        await client.writeRegister(0x0801, 2); 
        // 2. Stel het laadvermogen in
        await client.writeRegister(0x0802, powerWatts);
        console.log(`⚡ AlphaESS: Grid charging gestart op ${powerWatts}W`);
      } else {
        // Zet terug naar de standaard (Self-consumption)
        await client.writeRegister(0x0801, 1);
        console.log(`🛑 AlphaESS: Grid charging gestopt`);
      }
      return true;
    } catch (e) {
      console.error('❌ AlphaESS Modbus Write Error:', e.message);
      return false;
    }
  }
};