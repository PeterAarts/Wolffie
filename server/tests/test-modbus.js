#!/usr/bin/env node

import ModbusRTU from 'modbus-serial';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ══════════════════════════════════════════════════════════════
// 1. CONNECTION DEFAULTS & CONFIG LOADING
// ══════════════════════════════════════════════════════════════
const IP_ADDRESS = '192.168.3.156';
const PORT = 502;
const SLAVE_ID = 85;
const DELAY_MS = 400; // ⏱️ Enforced hardware safety delay

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Points to the register settings file in the module folder
const regPath = path.join(__dirname, '..', 'modules', 'alphaess-modbus-tcp', 'config', 'register_settings.json');

// ══════════════════════════════════════════════════════════════
// 2. HELPER: READ AND SCALE REGISTER
// ══════════════════════════════════════════════════════════════

async function testRegister(client, key, cfg) {
  const { address, length, type, scale, name, signed, offset } = cfg;
  
  try {
    const res = await client.readHoldingRegisters(address, length || 1);
    let rawValue;

    if (length === 2) {
      // 32-bit Big Endian: (High Word << 16) | Low Word
      rawValue = (res.data[0] << 16) | res.data[1];
      // Handle signed 32-bit (Int32 range: -2,147,483,648 to 2,147,483,647)
      if (signed && rawValue > 2147483647) rawValue -= 4294967296;
    } else {
      // 16-bit
      rawValue = res.data[0];
      // Handle signed 16-bit (Int16 range: -32,768 to 32,767)
      if (signed && rawValue > 32767) rawValue -= 65536;
    }

    // Apply offset (e.g., -32000 for dispatch) then scale
    const processedValue = ((rawValue + (offset || 0)) * (scale || 1.0)).toFixed(3);
    
    console.log(`\x1b[37m- ${name || key}   \x1b[97m ${processedValue} \x1b[37m ${cfg.unit || ''}`);
    
    return true;
  } catch (err) {
    console.error(`❌ Error reading ${name || key} (Addr ${address}): ${err.message}\n`);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// 3. MAIN TEST EXECUTION
// ══════════════════════════════════════════════════════════════

async function runFullTest() {
  const client = new ModbusRTU();

  // Load the settings
  let registerData;
  try {
    const content = fs.readFileSync(regPath, 'utf8');
    registerData = JSON.parse(content).registers;
    console.log(`\n📖 Loaded register_settings.json successfully.`);
  } catch (err) {
    console.error(`\n - Failed to load config from ${regPath}: ${err.message}`);
    return;
  }

  try {
    console.log(` - Connecting to ${IP_ADDRESS}:${PORT} (ID: ${SLAVE_ID})...`);
    await client.connectTCP(IP_ADDRESS, { port: PORT });
    await client.setID(SLAVE_ID);
    client.setTimeout(2500);
    console.log(' - Connected.\n');

    // Iterate through groups (system, battery, solar, etc.)
    for (const [groupName, registers] of Object.entries(registerData)) {
      console.log(`\x1b[32m═══ Group: ${groupName.toUpperCase()} ═══\x1b[37m`);
      
      for (const [key, cfg] of Object.entries(registers)) {
        await testRegister(client, key, cfg);
        
        // Respect the hardware safety delay between every read
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }

  } catch (e) {
    console.error(`\n - Connection or Protocol Error: ${e.message}`);
  } finally {
    client.close();
    console.log(' - Batch verification complete.');
    exit;
  }
}

runFullTest();