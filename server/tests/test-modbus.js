#!/usr/bin/env node

// Basic Network Connectivity Test
// Tests if the device is reachable before attempting ModBus

import { spawn } from 'child_process';
import { createConnection } from 'net';
import ModbusRTU from 'modbus-serial';

const TEST_IPS = [
  '192.168.1.158'
];

const MODBUS_PORT = 502;
const SLAVE_ID = 85;
const COMMAND_INTERVAL = 300; // Minimum 300ms between commands (per Alpha ESS spec)

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║         AlphaESS Network Connectivity Test               ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// Helper function to wait between commands
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test 1: TCP connection test (more reliable than ping)
async function testTCPConnection(ip, port) {
  return new Promise((resolve) => {
    console.log(`📡 Testing TCP connectivity to ${ip}:${port}...`);
    
    const socket = createConnection({ host: ip, port, timeout: 5000 });
    
    socket.on('connect', () => {
      console.log(`   ✅ Device is reachable (TCP connection successful)`);
      socket.destroy();
      resolve({ success: true });
    });
    
    socket.on('timeout', () => {
      console.log(`   ⚠️  Connection timeout (device may be unreachable)`);
      socket.destroy();
      resolve({ success: false, error: 'timeout' });
    });
    
    socket.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        console.log(`   ⚠️  Connection refused (device is reachable but port closed)`);
        console.log(`   💡 ModBus TCP service may not be enabled`);
      } else if (err.code === 'ETIMEDOUT' || err.code === 'EHOSTUNREACH') {
        console.log(`   ❌ Device is NOT reachable (${err.code})`);
      } else {
        console.log(`   ❌ Connection error: ${err.message}`);
      }
      resolve({ success: false, error: err.code });
    });
  });
}

// Test 2: ModBus connection and basic read test
async function testModBus(ip, port, slaveId) {
  return new Promise((resolve) => {
    console.log(`\n🔧 Testing ModBus protocol...`);
    console.log(`   ⏱️  Respecting ${COMMAND_INTERVAL}ms command interval (per Alpha ESS spec)`);
    
    const client = new ModbusRTU();
    const timeout = 5000;
    
    client.connectTCP(ip, { port }, async (err) => {
      if (err) {
        console.log(`   ❌ ModBus connection failed: ${err.message}`);
        resolve({ success: false, error: err.message });
        return;
      }
      
      console.log(`   ✅ ModBus TCP connection established`);
      
      client.setID(slaveId);
      client.setTimeout(timeout);
      
      // Wait before first command
      await sleep(COMMAND_INTERVAL);
      
      // Try to read battery SOC (register 0x0102 = 258)
      console.log(`   🔍 Attempting to read register 0x0102 (258 dec) - Battery SOC...`);
      
      client.readHoldingRegisters(258, 1, async (err, data) => {
        if (err) {
          console.log(`   ❌ ModBus read failed: ${err.message}`);
          if (err.message.includes('Timed out') || err.message.includes('timeout')) {
            console.log(`   💡 Device accepts connections but doesn't respond to ModBus queries`);
            console.log(`      • Check if Slave ID ${slaveId} (0x${slaveId.toString(16).toUpperCase()}) is correct`);
            console.log(`      • Verify ModBus TCP protocol is enabled in inverter settings`);
            console.log(`      • Some devices require authentication/pairing first`);
          }
          client.close(() => {});
          resolve({ success: false, error: err.message });
        } else {
          const soc = data.data[0] / 10; // SOC is in 0.1% units
          console.log(`   ✅ ModBus read successful!`);
          console.log(`   📊 Battery SOC: ${soc.toFixed(1)}%`);
          
          // Wait before next command
          await sleep(COMMAND_INTERVAL);
          
          // Try reading another register to confirm consistent communication
          console.log(`\n   🔍 Testing second read - register 0x0100 (256 dec) - Battery Voltage...`);
          
          client.readHoldingRegisters(256, 1, (err, data) => {
            if (err) {
              console.log(`   ⚠️  Second read failed: ${err.message}`);
              client.close(() => {});
              resolve({ success: true, data: { soc }, warning: 'partial' });
            } else {
              const voltage = data.data[0] / 10; // Voltage is in 0.1V units
              console.log(`   ✅ Second read successful!`);
              console.log(`   📊 Battery Voltage: ${voltage.toFixed(1)}V`);
              client.close(() => {});
              resolve({ success: true, data: { soc, voltage } });
            }
          });
        }
      });
    });
  });
}

// Main test sequence
async function runTests() {
  for (const ip of TEST_IPS) {
    console.log(`\n${'='.repeat(65)}`);
    console.log(`Testing: ${ip}`);
    console.log('='.repeat(65));
    
    // Step 1: TCP connection test
    const tcpResult = await testTCPConnection(ip, MODBUS_PORT);
    
    if (!tcpResult.success) {
      if (tcpResult.error === 'ECONNREFUSED') {
        console.log(`\n⚠️  Device is reachable but ModBus TCP (port 502) is not responding`);
        console.log(`\n🔧 Next steps:`);
        console.log(`   1. Access the inverter web interface or display panel`);
        console.log(`   2. Navigate to Settings → Communication → ModBus TCP`);
        console.log(`   3. Enable ModBus TCP protocol`);
        console.log(`   4. Verify port is set to 502`);
        console.log(`   5. Check if a password/authentication is required`);
        console.log(`   6. Restart the inverter after enabling ModBus`);
      } else {
        console.log(`\n❌ Device ${ip} is not reachable on the network`);
        console.log(`\n🔧 Troubleshooting:`);
        console.log(`   1. Verify the IP address is correct`);
        console.log(`   2. Check if device is powered on`);
        console.log(`   3. Verify network cable is connected (for Ethernet)`);
        console.log(`   4. Check WiFi connection status (for WiFi)`);
        console.log(`   5. Check firewall settings on your machine`);
      }
      continue;
    }
    
    // Step 2: ModBus protocol test
    const modbusResult = await testModBus(ip, MODBUS_PORT, SLAVE_ID);
    
    if (modbusResult.success) {
      console.log(`\n🎉 SUCCESS! ModBus is fully working on ${ip}!`);
      console.log(`\n📝 Configuration:`);
      console.log(`   MODBUS_IP=${ip}`);
      console.log(`   MODBUS_PORT=${MODBUS_PORT}`);
      console.log(`   MODBUS_SLAVE_ID=${SLAVE_ID}`);
      console.log(`   COMMAND_INTERVAL=${COMMAND_INTERVAL}ms (min time between commands)`);
      console.log(`\n✅ You can now use these settings in your monitoring application`);
      
      if (modbusResult.warning === 'partial') {
        console.log(`\n⚠️  Note: First read succeeded but second failed - may need longer intervals`);
      }
    } else {
      console.log(`\n⚠️  ModBus connection established but protocol communication failed`);
      console.log(`\n🔧 Possible causes:`);
      console.log(`   1. Incorrect Slave ID (current: ${SLAVE_ID})`);
      console.log(`   2. ModBus protocol not fully enabled/configured`);
      console.log(`   3. Device requires authentication/pairing`);
      console.log(`   4. Wrong register address or function code`);
    }
  }
  
  console.log(`\n${'='.repeat(65)}\n`);
}

runTests().catch(console.error);