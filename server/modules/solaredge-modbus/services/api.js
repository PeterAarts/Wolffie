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

    const host = config.host || config.ip_address;
    const port = Number(config.port);

    if (!host || !port) {
      throw new Error(`Missing connection parameters: host=${host}, port=${port}`);
    }

    await this.client.connectTCP(host, { port });
    this.client.setID(Number(config.unit_id) || 1);
    this.client.setTimeout(Number(config.timeout) || 5000);
    return true;
  }

  async readBlock(blockName) {
    const block = registers.blocks[blockName];
    if (!block) throw new Error(`Unknown register block: ${blockName}`);

    // SunSpec addresses are 1-based; modbus-serial is 0-based
    const raw = await this.client.readHoldingRegisters(block.address - 1, block.length);
    return this.decodeBlock(raw.data, block.fields);
  }

  decodeBlock(values, fields) {
    const result = {};

    // First pass: extract raw values
    fields.forEach(f => {
      if (!f.key) return;

      switch (f.type) {
        case 'uint16':
          result[f.key] = values[f.offset];
          break;

        case 'int16':
        case 'sunssf':
          // Correct signed 16-bit interpretation
          result[f.key] = values[f.offset] > 0x7FFF
            ? values[f.offset] - 0x10000
            : values[f.offset];
          break;

        case 'uint32':
          // Use multiplication to avoid JS signed 32-bit bitwise truncation
          result[f.key] = values[f.offset] * 0x10000 + values[f.offset + 1];
          break;

        case 'string': {
          // Two chars per register, null-terminated
          const chars = [];
          for (let i = 0; i < (f.length || 1); i++) {
            const reg = values[f.offset + i];
            const hi = (reg >> 8) & 0xFF;
            const lo = reg & 0xFF;
            if (hi) chars.push(String.fromCharCode(hi));
            if (lo) chars.push(String.fromCharCode(lo));
          }
          result[f.key] = chars.join('').replace(/\0/g, '').trim();
          break;
        }
      }
    });

    // Second pass: apply scale factors (value × 10^SF)
    fields.forEach(f => {
      if (!f.key || !f.scale) return;
      const sf = result[f.scale];
      if (sf !== undefined && sf !== null) {
        result[f.key] = parseFloat((result[f.key] * Math.pow(10, sf)).toFixed(4));
      }
    });

    return result;
  }

  /**
   * Write a single holding register (0-based address internally)
   */
  async writeRegister(address, value) {
    try {
      await this.client.writeRegister(address - 1, value);
    } catch (error) {
      console.error(`❌ Modbus Write Error at register ${address}:`, error.message);
      throw error;
    }
  }

  /**
   * Set inverter active power limit (curtailment)
   * @param {number} percentage - 0 to 100
   */
  async setPowerLimit(percentage) {
    const block = registers.blocks.controls;
    const value = Math.round(percentage * 100); // 0-100% → 0-10000

    // 1. Enable power limiting (offset 6 = register 40237)
    await this.writeRegister(block.address + 6, 1);
    // 2. Set limit value (offset 2 = register 40233)
    await this.writeRegister(block.address + 2, value);

    console.log(`   ✓ SolarEdge power limit set to ${percentage}%`);
    return true;
  }
}

export default new SolarEdgeAPI();