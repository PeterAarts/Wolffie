import ModbusRTU from 'modbus-serial';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registers = JSON.parse(readFileSync(path.join(__dirname, '../config/register_schema.json'), 'utf8'));

class SolarEdgeAPI {
  constructor() {
    this.client = new ModbusRTU();
    this.config = null;
  }

async connect(config) {
  this.config = config;
  if (this.client.isOpen) return true;
  
  // Use host or ip_address, and ensure port is a Number
  const host = config.host || config.ip_address;
  const port = Number(config.port);

  if (!host || !port) {
    throw new Error(`Missing connection parameters: host=${host}, port=${port}`);
  }
  
  await this.client.connectTCP(host, { port: port });
  await this.client.setID(config.unit_id || 1);
  this.client.setTimeout(config.timeout || 5000);
  return true;
}
  /**
   * Write a value to a specific register
   */
  async writeRegister(address, value) {
    try {
      // SunSpec addresses are often 1-based, ModbusRTU is 0-based
      const result = await this.client.writeRegister(address - 1, value);
      return result;
    } catch (error) {
      console.error(`❌ Modbus Write Error at ${address}:`, error.message);
      throw error;
    }
  }

  /**
   * Set Inverter Power Limit (Curtailment)
   * @param {number} percentage - 0 to 100
   */
  async setPowerLimit(percentage) {
    const block = registers.blocks.controls;
    const value = Math.round(percentage * 100); // Convert 0-100 to 0-10000

    try {
      console.log(`   - Setting SolarEdge Power Limit to ${percentage}%...`);
      // 1. Enable Power Limiting (Register 40237 / Offset 6)
      await this.writeRegister(block.address + 6, 1);
      
      // 2. Set the Limit (Register 40233 / Offset 2)
      await this.writeRegister(block.address + 2, value);
      
      return true;
    } catch (error) {
      throw new Error(`   - Inverter Curtailment Failed: ${error.message}`);
    }
  }
  async readBlock(blockName) {
    const block = registers.blocks[blockName];
    // Modbus addresses in schemas are often 1-based, ModbusRTU uses 0-based
    const data = await this.client.readHoldingRegisters(block.address - 1, block.length);
    return this.decodeBlock(data.data, block.fields);
  }

  decodeBlock(values, fields) {
    const result = {};
    // First pass: extract all raw values
    fields.forEach(f => {
      if (f.type === 'uint16') result[f.key] = values[f.offset];
      if (f.type === 'int16') result[f.key] = (values[f.offset] << 16 >> 16); // Handle signed 16-bit
      if (f.type === 'sunssf') result[f.key] = (values[f.offset] << 16 >> 16); // Scale factor is signed
      if (f.type === 'uint32') result[f.key] = (values[f.offset] << 16) | values[f.offset + 1];
    });

    // Second pass: apply scale factors (Value * 10^SF)
    fields.forEach(f => {
      if (f.scale && result[f.scale] !== undefined) {
        result[f.key] = result[f.key] * Math.pow(10, result[f.scale]);
      }
    });

    return result;
  }
}

export default new SolarEdgeAPI();