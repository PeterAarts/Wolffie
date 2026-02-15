#!/usr/bin/env node
// modbus-diagnostic.js - Comprehensive AlphaESS ModBus TCP Diagnostic Tool
// Tests connectivity, reads key registers, and validates ModBus communication
// 
// UPDATED: Uses correct Alpha ESS specifications:
// - Command interval: 300ms minimum (per Alpha ESS ModBus protocol spec)
// - Holding registers (function code 0x03) instead of input registers
// - Proper register addresses from Alpha ESS documentation

import ModbusRTU from 'modbus-serial';
import { performance } from 'perf_hooks';

// Configuration
const TEST_CONFIG = {
  ips: [
    { name: 'Ethernet', ip: '192.168.1.158' },
  ],
  port: 502,
  slaveId: 85, // 0x55 - Default for Alpha ESS Smile G3
  timeout: 5000,
  retries: 3,
  commandInterval: 300 // Alpha ESS requires minimum 300ms between commands
};

// AlphaESS Register Map for Testing - Based on official Alpha ESS ModBus Protocol v1.28
// All addresses are decimal (documentation shows hex, converted here)
const TEST_REGISTERS = {
  // Battery Data (0x0100-0x0127)
  batteryVoltage: { address: 256, length: 1, type: 'uint16', scale: 0.1, unit: 'V', name: 'Battery Voltage', signed: false },
  batteryCurrent: { address: 257, length: 1, type: 'int16', scale: 0.1, unit: 'A', name: 'Battery Current', signed: true },
  batterySOC: { address: 258, length: 1, type: 'uint16', scale: 0.1, unit: '%', name: 'Battery SOC', signed: false },
  batteryStatus: { address: 259, length: 1, type: 'uint16', scale: 1.0, unit: '', name: 'Battery Status', signed: false },
  batteryPower: { address: 294, length: 1, type: 'int16', scale: 1.0, unit: 'W', name: 'Battery Power', signed: true },
  batterySOH: { address: 283, length: 1, type: 'uint16', scale: 0.1, unit: '%', name: 'Battery SOH', signed: false },
  batteryCapacity: { address: 281, length: 1, type: 'uint16', scale: 0.1, unit: 'kWh', name: 'Battery Capacity', signed: false },
  
  // Inverter Data (0x0400-0x0440)
  inverterVoltageL1: { address: 1024, length: 1, type: 'uint16', scale: 0.1, unit: 'V', name: 'Inverter Voltage L1', signed: false },
  inverterCurrentL1: { address: 1027, length: 1, type: 'int16', scale: 0.1, unit: 'A', name: 'Inverter Current L1', signed: true },
  inverterTotalPower: { address: 1036, length: 2, type: 'int32', scale: 1.0, unit: 'W', name: 'Inverter Total Power', signed: true },
  gridFrequency: { address: 1052, length: 1, type: 'uint16', scale: 0.01, unit: 'Hz', name: 'Grid Frequency', signed: false },
  inverterTemp: { address: 1077, length: 1, type: 'int16', scale: 0.1, unit: '°C', name: 'Inverter Temperature', signed: true },
  inverterWorkMode: { address: 1088, length: 1, type: 'uint16', scale: 1.0, unit: '', name: 'Inverter Work Mode', signed: false },
  
  // Grid Meter (0x0010-0x0036)
  gridVoltageA: { address: 20, length: 1, type: 'uint16', scale: 1.0, unit: 'V', name: 'Grid Voltage A', signed: false },
  gridCurrentA: { address: 23, length: 1, type: 'int16', scale: 0.1, unit: 'A', name: 'Grid Current A', signed: true },
  gridTotalActivePower: { address: 33, length: 2, type: 'int32', scale: 1.0, unit: 'W', name: 'Grid Active Power', signed: true },
  gridPowerFactor: { address: 54, length: 1, type: 'int16', scale: 0.01, unit: '', name: 'Grid Power Factor', signed: true },
  
  // System Info (0x0700-0x072B)
  systemFault: { address: 1793, length: 2, type: 'uint32', scale: 1.0, unit: '', name: 'System Fault', signed: false },
  systemMode: { address: 1820, length: 1, type: 'uint16', scale: 1.0, unit: '', name: 'System Mode', signed: false },
};

// === Utility Functions ===

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatValue(value, scale, unit) {
  const scaled = value * scale;
  return `${scaled.toFixed(scale < 1 ? 1 : 0)}${unit}`;
}

function convertToSigned32(data) {
  let value = (data[0] << 16) | data[1];
  if (value > 0x7FFFFFFF) value -= 0x100000000;
  return value;
}

function convertToSigned16(value) {
  // Convert unsigned 16-bit to signed 16-bit
  if (value > 32767) {
    return value - 65536;
  }
  return value;
}

function parseRegisterValue(data, register) {
  let value;
  
  if (register.type === 'int32') {
    value = convertToSigned32(data.data);
  } else if (register.type === 'uint32') {
    value = (data.data[0] << 16) | data.data[1];
  } else if (register.type === 'int16') {
    value = convertToSigned16(data.data[0]);
  } else if (register.type === 'uint16') {
    value = data.data[0];
  } else {
    value = data.data[0];
  }
  
  return value;
}

function interpretBatteryStatus(status) {
  const states = {
    0: 'Idle',
    1: 'Discharging',
    256: 'Charging',
    257: 'Charging + Discharging'
  };
  return states[status] || `Unknown (${status})`;
}

function interpretWorkMode(mode) {
  const modes = {
    0: 'Wait Mode',
    1: 'Online Mode',
    2: 'UPS Mode',
    3: 'Bypass Mode',
    4: 'Fault Mode',
    5: 'DC Mode'
  };
  return modes[mode] || `Unknown (${mode})`;
}

// === Test Functions ===

async function testTCPConnection(ip, port) {
  const start = performance.now();
  const client = new ModbusRTU();
  
  try {
    await client.connectTCP(ip, { port });
    const duration = (performance.now() - start).toFixed(0);
    client.close(() => {});
    return { success: true, duration };
  } catch (error) {
    const duration = (performance.now() - start).toFixed(0);
    return { success: false, error: error.message, duration };
  }
}

async function testModBusRead(ip, port, slaveId, register) {
  const client = new ModbusRTU();
  
  try {
    await client.connectTCP(ip, { port });
    client.setID(slaveId);
    client.setTimeout(TEST_CONFIG.timeout);
    
    const start = performance.now();
    // Use readHoldingRegisters (function code 0x03) as per Alpha ESS specification
    const data = await client.readHoldingRegisters(register.address, register.length);
    const duration = (performance.now() - start).toFixed(0);
    
    const value = parseRegisterValue(data, register);
    const formatted = formatValue(value, register.scale, register.unit);
    
    client.close(() => {});
    
    return {
      success: true,
      value,
      formatted,
      duration,
      raw: data.data
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function performFullDiagnostic(config) {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║     AlphaESS ModBus TCP Diagnostic Tool v2.0                 ║');
  console.log('║     Based on Alpha ESS ModBus Protocol v1.28                  ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
  
  console.log(`📋 Test Configuration:`);
  console.log(`   Port: ${config.port}`);
  console.log(`   Slave ID: ${config.slaveId} (0x${config.slaveId.toString(16).toUpperCase()})`);
  console.log(`   Timeout: ${config.timeout}ms`);
  console.log(`   Command Interval: ${config.commandInterval}ms (Alpha ESS spec requirement)`);
  console.log(`   Retries: ${config.retries}\n`);
  
  const results = {};
  
  // Test each IP
  for (const connection of config.ips) {
    console.log(`\n${'='.repeat(65)}`);
    console.log(`Testing ${connection.name}: ${connection.ip}`);
    console.log('='.repeat(65));
    
    const connectionResult = {
      name: connection.name,
      ip: connection.ip,
      tests: {}
    };
    
    // Phase 1: TCP Connection Test
    console.log('\n📡 Phase 1: TCP Connection Test');
    const tcpTest = await testTCPConnection(connection.ip, config.port);
    
    if (tcpTest.success) {
      console.log(`   ✅ TCP connection successful (${tcpTest.duration}ms)`);
      connectionResult.tcpConnected = true;
    } else {
      console.log(`   ❌ TCP connection failed (${tcpTest.duration}ms)`);
      console.log(`   Error: ${tcpTest.error}`);
      connectionResult.tcpConnected = false;
      connectionResult.tcpError = tcpTest.error;
      results[connection.name] = connectionResult;
      continue; // Skip to next IP
    }
    
    // Phase 2: ModBus Protocol Test
    console.log('\n🔌 Phase 2: ModBus Protocol Test (Reading Registers)');
    console.log(`   ⏱️  Respecting ${config.commandInterval}ms interval between commands\n`);
    
    let successfulReads = 0;
    let failedReads = 0;
    let firstRead = true;
    
    for (const [key, register] of Object.entries(TEST_REGISTERS)) {
      // Wait before each command (except the first one)
      if (!firstRead) {
        await sleep(config.commandInterval);
      }
      firstRead = false;
      
      const result = await testModBusRead(connection.ip, config.port, config.slaveId, register);
      connectionResult.tests[key] = result;
      
      if (result.success) {
        let displayValue = result.formatted;
        
        // Add interpretation for status/mode registers
        if (key === 'batteryStatus') {
          displayValue += ` (${interpretBatteryStatus(result.value)})`;
        } else if (key === 'inverterWorkMode') {
          displayValue += ` (${interpretWorkMode(result.value)})`;
        }
        
        console.log(`   ✅ ${register.name.padEnd(25)} ${displayValue.padStart(15)} (${result.duration}ms)`);
        successfulReads++;
      } else {
        console.log(`   ❌ ${register.name.padEnd(25)} Failed: ${result.error}`);
        failedReads++;
      }
    }
    
    connectionResult.successfulReads = successfulReads;
    connectionResult.failedReads = failedReads;
    connectionResult.modbusWorking = successfulReads > 0;
    
    // Phase 3: Summary
    console.log(`\n📊 Test Summary for ${connection.name}:`);
    console.log(`   Successful reads: ${successfulReads}/${successfulReads + failedReads}`);
    
    if (successfulReads > 0) {
      console.log(`   🎉 ModBus is WORKING on ${connection.name}!`);
    } else {
      console.log(`   ⚠️  ModBus is NOT working on ${connection.name}`);
    }
    
    results[connection.name] = connectionResult;
  }
  
  return results;
}

function printFinalReport(results) {
  console.log('\n\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                    DIAGNOSTIC REPORT                          ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
  
  let workingConnection = null;
  
  for (const [name, result] of Object.entries(results)) {
    console.log(`\n${name} (${result.ip}):`);
    console.log(`   TCP Connection: ${result.tcpConnected ? '✅ Working' : '❌ Failed'}`);
    
    if (result.tcpConnected) {
      console.log(`   ModBus Protocol: ${result.modbusWorking ? '✅ Working' : '❌ Failed'}`);
      console.log(`   Successful Reads: ${result.successfulReads}/${result.successfulReads + result.failedReads}`);
      
      if (result.modbusWorking && !workingConnection) {
        workingConnection = result;
      }
    } else {
      console.log(`   Error: ${result.tcpError}`);
    }
  }
  
  console.log('\n' + '='.repeat(65));
  console.log('RECOMMENDATIONS:');
  console.log('='.repeat(65) + '\n');
  
  if (workingConnection) {
    console.log('✅ ModBus IS WORKING!\n');
    console.log(`🎯 Use this connection: ${workingConnection.name} (${workingConnection.ip})`);
    console.log('\n📝 Configuration for your monitoring application:');
    console.log(`   MODBUS_IP=${workingConnection.ip}`);
    console.log(`   MODBUS_PORT=${TEST_CONFIG.port}`);
    console.log(`   MODBUS_SLAVE_ID=${TEST_CONFIG.slaveId}`);
    console.log(`   COMMAND_INTERVAL=${TEST_CONFIG.commandInterval}ms\n`);
    
    console.log('💡 Important notes:');
    console.log('   • Always wait at least 300ms between ModBus commands');
    console.log('   • Use readHoldingRegisters (function code 0x03)');
    console.log('   • Device response time should be < 300ms');
    console.log('   • Communication timeout should be > 10 seconds\n');
    
    console.log('📊 Sample data retrieved:');
    if (workingConnection.tests.batterySOC?.success) {
      console.log(`   Battery SOC: ${workingConnection.tests.batterySOC.formatted}`);
    }
    if (workingConnection.tests.batteryVoltage?.success) {
      console.log(`   Battery Voltage: ${workingConnection.tests.batteryVoltage.formatted}`);
    }
    if (workingConnection.tests.batteryCurrent?.success) {
      console.log(`   Battery Current: ${workingConnection.tests.batteryCurrent.formatted}`);
    }
    if (workingConnection.tests.batteryPower?.success) {
      console.log(`   Battery Power: ${workingConnection.tests.batteryPower.formatted}`);
    }
    if (workingConnection.tests.batteryStatus?.success) {
      const status = interpretBatteryStatus(workingConnection.tests.batteryStatus.value);
      console.log(`   Battery Status: ${status}`);
    }
    if (workingConnection.tests.gridTotalActivePower?.success) {
      console.log(`   Grid Power: ${workingConnection.tests.gridTotalActivePower.formatted}`);
    }
    if (workingConnection.tests.gridFrequency?.success) {
      console.log(`   Grid Frequency: ${workingConnection.tests.gridFrequency.formatted}`);
    }
    if (workingConnection.tests.inverterWorkMode?.success) {
      const mode = interpretWorkMode(workingConnection.tests.inverterWorkMode.value);
      console.log(`   Inverter Mode: ${mode}`);
    }
    
  } else {
    console.log('❌ ModBus is NOT working on either connection.\n');
    console.log('🔍 Troubleshooting steps:\n');
    
    // Check if any TCP connections worked
    const anyTCPWorked = Object.values(results).some(r => r.tcpConnected);
    
    if (anyTCPWorked) {
      console.log('   TCP connection works but ModBus protocol fails.');
      console.log('   This usually means:\n');
      console.log('   1. ⚠️  ModBus TCP is not enabled in the inverter settings');
      console.log('      → Contact your installer to enable ModBus TCP protocol');
      console.log('      → Check inverter display/web interface for ModBus settings\n');
      console.log('   2. ⚠️  Wrong Slave ID (currently using 85/0x55)');
      console.log('      → Try Slave ID 1, 17 (0x11), or 255 (0xFF)');
      console.log('      → Check inverter documentation for correct Slave ID\n');
      console.log('   3. ⚠️  Inverter requires different register addresses');
      console.log('      → Verify your inverter model is AlphaESS Smile G3');
      console.log('      → Check for model-specific register maps\n');
    } else {
      console.log('   TCP connection failed on both interfaces.');
      console.log('   This usually means:\n');
      console.log('   1. ⚠️  Network connectivity issue');
      console.log('      → Verify IP addresses are correct and reachable');
      console.log('      → Try: ping 192.168.1.158 and ping 192.168.1.179\n');
      console.log('   2. ⚠️  Firewall blocking port 502');
      console.log('      → Check firewall rules on your computer');
      console.log('      → Check inverter firewall settings if available\n');
      console.log('   3. ⚠️  Inverter is offline or network is down');
      console.log('      → Check inverter display for network status');
      console.log('      → Verify inverter web interface is accessible\n');
    }
    
    console.log('📞 Next steps:');
    console.log('   1. Contact your installer to confirm ModBus TCP is enabled');
    console.log('   2. Request the correct Slave ID for your Smile G3 inverter');
    console.log('   3. Verify network configuration (IP, port 502, protocol settings)');
    console.log('   4. Ask installer to check if any authentication is required');
  }
  
  console.log('\n' + '='.repeat(65) + '\n');
}

// === Main Execution ===

async function main() {
  try {
    const results = await performFullDiagnostic(TEST_CONFIG);
    printFinalReport(results);
  } catch (error) {
    console.error('\n❌ Fatal error during diagnostic:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();