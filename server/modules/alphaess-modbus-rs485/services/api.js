// modules/alphaess-modbus-rs485/services/api.js
import ModbusRTU from 'modbus-serial';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import settingsService from '../../../core/system/services/settingsService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class AlphaESSModbusAPI {
  constructor() {
    this.client = new ModbusRTU();
    this.isConnected = false;
    this.stats = { lastRequestTime: null, lastError: null };
    
    const schemaPath = path.join(__dirname, '../config/register_schema.json');
    this.schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  }

  async connect() {
    if (this.isConnected && this.client.isOpen) return;
    const settings = await settingsService.getCategory('alphaess-modbus-rs485');
    
    if (!settings?.port) throw new Error('RS485 port not configured in settings');

    try {
      await this.client.connectRTUBuffered(settings.port, { 
        baudRate: parseInt(settings.baudrate) || 9600 
      });
      this.client.setID(parseInt(settings.slave_id) || 85);
      this.client.setTimeout(parseInt(settings.timeout) || 2000);
      this.isConnected = true;
    } catch (error) {
      this.isConnected = false;
      this.stats.lastError = error.message;
      throw error;
    }
  }

  /**
   * Generic reader using the schema-defined blocks
   */
  async readBlock(blockKey) {
    await this.connect();
    const block = this.schema.blocks[blockKey];
    if (!block) throw new Error(`Block ${blockKey} missing in schema`);

    try {
      const res = await this.client.readHoldingRegisters(block.address, block.length);
      const result = {};
      
      block.fields.forEach(field => {
        let val = res.data[field.offset];
        
        // Handle signed 16-bit
        if (field.type === 'int16' && val > 32767) val -= 65536;

        // Apply scaling (e.g., 0.1 for Volts/Temp)
        if (field.scale) val = parseFloat((val * field.scale).toFixed(2));

        result[field.key] = val;
      });

      this.stats.lastRequestTime = new Date();
      return result;
    } catch (error) {
      this.isConnected = false;
      this.stats.lastError = error.message;
      throw error;
    }
  }

  /**
   * Universal write method for any register in the schema
   */
  async writeValue(blockKey, fieldKey, value) {
    await this.connect();
    const block = this.schema.blocks[blockKey];
    const field = block?.fields.find(f => f.key === fieldKey);
    
    if (!field) throw new Error(`Field ${fieldKey} not found in ${blockKey}`);

    try {
      // Re-scale value if necessary (e.g., 50.5V -> 505)
      const writeVal = field.scale ? Math.round(value / field.scale) : value;
      await this.client.writeRegister(block.address + field.offset, writeVal);
      return true;
    } catch (error) {
      this.stats.lastError = error.message;
      throw error;
    }
  }

  async getRealtimeData() { return await this.readBlock('realtime'); }
  async getSystemSettings() { return await this.readBlock('settings'); }
  
  getStats() { return this.stats; }
}

export default new AlphaESSModbusAPI();