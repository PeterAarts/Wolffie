// modules/alphaess-modbus-tcp/services/api.js
import ModbusRTU from 'modbus-serial';
import { createConnection } from 'net'; // Nodig voor de snelle poort-check
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const regPath = path.join(__dirname, '../config/register_settings.json');

class AlphaModbusAPI {
  constructor() {
    this.client = new ModbusRTU();
    this.connected = false;
    this.lastCallTime = 0;
    this.minDelay = 400; 
    this.queue = Promise.resolve();
    
    try {
      const rawData = JSON.parse(fs.readFileSync(regPath, 'utf8'));
      this.groups = rawData.registers;
    } catch (e) {
      this.groups = null;
    }
  }

  /**
   * 🛡️ De veilige 'Originele' Check: Controleert of poort 502 bereikbaar is.
   * Dit blokkeert de Modbus-sessie NIET.
   */
  async checkStatus(host, port) {
    return new Promise((resolve) => {
      const socket = createConnection({ host, port: parseInt(port), timeout: 3000 });
      
      socket.on('connect', () => {
        socket.destroy(); // Direct weer vrijgeven!
        resolve(true);
      });
      
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  async _safeCall(operation) {
    this.queue = this.queue.then(async () => {
      const now = Date.now();
      const elapsed = now - this.lastCallTime;
      if (elapsed < this.minDelay) await new Promise(r => setTimeout(r, this.minDelay - elapsed));
      try {
        const result = await operation();
        this.lastCallTime = Date.now();
        return result;
      } catch (e) {
        this.lastCallTime = Date.now();
        this.connected = false;
        throw e;
      }
    });
    return this.queue;
  }

  async connect(host, port, unitId) {
    if (this.connected && this.client.isOpen) return;
    try {
      if (this.client.isOpen) await this.client.close();
      await this.client.connectTCP(host, { port: parseInt(port) });
      await this.client.setID(parseInt(unitId));
      this.client.setTimeout(2500);
      this.connected = true;
    } catch (e) {
      this.connected = false;
      throw e;
    }
  }

  async _readRegister(cfg) {
    const res = await this._safeCall(() => this.client.readHoldingRegisters(cfg.address, cfg.length || 1));
    let val;
    if (cfg.length === 2) {
      val = (res.data[0] << 16) | res.data[1];
      if (cfg.signed && val > 2147483647) val -= 4294967296;
    } else {
      val = res.data[0];
      if (cfg.signed && val > 32767) val -= 65536;
    }
    return (val + (cfg.offset || 0)) * (cfg.scale || 1.0);
  }

  async fetchAll() {
    if (!this.groups) throw new Error('Configuratie ontbreekt');
    const result = {};
    for (const [groupName, registers] of Object.entries(this.groups)) {
      result[groupName] = {};
      for (const [key, cfg] of Object.entries(registers)) {
        result[groupName][key] = await this._readRegister(cfg);
      }
    }
    return result;
  }


  // Writable methods...
  async writeLimit(pct) { return await this._safeCall(() => this.client.writeRegister(this.registers.system.max_feed_in_percent.address, pct)); }
  async writeUPS(enabled) { return await this._safeCall(() => this.client.writeRegister(this.registers.system.ups_enable.address, enabled)); }
  async writeMinSoC(pct) { return await this._safeCall(() => this.client.writeRegister(this.registers.system.min_soc_backup.address, pct)); }
  async writeDoD(pct) { return await this._safeCall(() => this.client.writeRegister(this.registers.system.battery_dod.address, pct)); }
  
  async setDispatch(mode, watts, targetSoc) {
    await this._safeCall(() => this.client.writeRegister(this.registers.system.dispatch_mode.address, 2));
    await this._safeCall(() => this.client.writeRegister(this.registers.system.dispatch_cutoff_soc.address, targetSoc));
    const p = mode === 'charge' ? Math.abs(watts) * -1 : Math.abs(watts);
    return await this._safeCall(() => this.client.writeRegister(this.registers.system.dispatch_power.address, p));
  }
}

export default new AlphaModbusAPI();