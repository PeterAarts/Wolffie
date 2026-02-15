#!/usr/bin/env node

// AlphaESS RS485 ModBus Connectivity Test - Windows Compatible
// Tests USB-RS485 adapter connection to AlphaESS inverter

import ModbusRTU from 'modbus-serial';
import { SerialPort } from 'serialport';

// RS485 Configuration
const SERIAL_PORT = process.env.SERIAL_PORT || 'COM3'; // Windows COM port
const BAUD_RATE = parseInt(process.env.BAUD_RATE) || 9600;
const SLAVE_ID = parseInt(process.env.SLAVE_ID) || 85; // 0x55 in hex
const COMMAND_INTERVAL = 300; // Minimum 300ms between commands

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║       AlphaESS RS485 ModBus Connectivity Test            ║');
console.log('║                  Windows Version                          ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// Helper function to wait between commands
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Step 1: List available serial ports
async function listSerialPorts() {
  console.log('📡 Detecting available COM ports...\n');
  
  try {
    const ports = await SerialPort.list();
    
    if (ports.length === 0) {
      console.log('❌ No COM ports detected!');
      console.log('\n🔧 Troubleshooting:');
      console.log('   1. Is the USB-RS485 adapter plugged in?');
      console.log('   2. Check Device Manager → Ports (COM & LPT)');
      console.log('   3. Install FTDI or CH340 driver if needed');
      console.log('   4. Try unplugging and replugging the adapter');
      return null;
    }
    
    console.log('Found COM ports:');
    ports.forEach((port, index) => {
      console.log(`\n   ${index + 1}. ${port.path}`);
      if (port.manufacturer) console.log(`      Manufacturer: ${port.manufacturer}`);
      if (port.friendlyName) console.log(`      Name: ${port.friendlyName}`);
      if (port.vendorId) console.log(`      Vendor ID: ${port.vendorId}`);
      if (port.productId) console.log(`      Product ID: ${port.productId}`);
      if (port.serialNumber) console.log(`      Serial: ${port.serialNumber}`);
      
      // Identify likely FTDI chip
      if (port.manufacturer && (
          port.manufacturer.toLowerCase().includes('ftdi') ||
          port.manufacturer.toLowerCase().includes('dsd tech')
      )) {
        console.log(`      ✅ FTDI/DSD TECH adapter detected!`);
      }
      
      // Identify CH340 chips (common alternative)
      if (port.manufacturer && port.manufacturer.toLowerCase().includes('ch340')) {
        console.log(`      ✅ CH340 adapter detected`);
      }
    });
    
    console.log(`\n💡 Tip: Check Device Manager to confirm which COM port your adapter is using`);
    console.log(`   Windows Key + X → Device Manager → Ports (COM & LPT)`);
    
    return ports;
  } catch (err) {
    console.log(`❌ Error listing ports: ${err.message}`);
    return null;
  }
}

// Step 2: Test serial port opening
async function testSerialPort(portPath) {
  return new Promise((resolve) => {
    console.log(`\n📡 Testing COM port: ${portPath}`);
    console.log(`   Baud rate: ${BAUD_RATE}`);
    console.log(`   Data bits: 8, Parity: None, Stop bits: 1 (8N1)`);
    
    const port = new SerialPort({
      path: portPath,
      baudRate: BAUD_RATE,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
      autoOpen: false
    });
    
    port.open((err) => {
      if (err) {
        console.log(`   ❌ Failed to open port: ${err.message}`);
        
        if (err.message.includes('Access is denied') || err.message.includes('in use')) {
          console.log('\n   💡 Port access issue detected!');
          console.log('   Possible causes:');
          console.log('   • Another program is using this port (Arduino IDE, PuTTY, etc.)');
          console.log('   • Close all programs that might use serial ports');
          console.log('   • Check Windows Device Manager for driver issues');
        } else if (err.message.includes('cannot find') || err.message.includes('could not open')) {
          console.log('\n   💡 Port not found!');
          console.log('   • Verify the COM port number in Device Manager');
          console.log('   • Try: SERIAL_PORT=COM4 node test-modbus-rs485.js');
        }
        
        resolve({ success: false, error: err.message });
        return;
      }
      
      console.log(`   ✅ COM port opened successfully!`);
      
      port.on('error', (err) => {
        console.log(`   ⚠️  Port error: ${err.message}`);
      });
      
      port.close(() => {
        resolve({ success: true });
      });
    });
  });
}

// Step 3: Test ModBus RTU communication
async function testModBusRTU(portPath, slaveId) {
  return new Promise((resolve) => {
    console.log(`\n🔧 Testing ModBus RTU protocol...`);
    console.log(`   Slave ID: ${slaveId} (0x${slaveId.toString(16).toUpperCase()})`);
    console.log(`   ⏱️  Respecting ${COMMAND_INTERVAL}ms command interval`);
    
    const client = new ModbusRTU();
    
    client.connectRTUBuffered(portPath, {
      baudRate: BAUD_RATE,
      dataBits: 8,
      parity: 'none',
      stopBits: 1
    }, async (err) => {
      if (err) {
        console.log(`   ❌ ModBus RTU connection failed: ${err.message}`);
        resolve({ success: false, error: err.message });
        return;
      }
      
      console.log(`   ✅ ModBus RTU connection established`);
      
      client.setID(slaveId);
      client.setTimeout(5000);
      
      // Wait before first command
      await sleep(COMMAND_INTERVAL);
      
      // Try to read battery SOC (register 0x0102 = 258)
      console.log(`   🔍 Reading register 0x0102 (258) - Battery SOC...`);
      
      client.readHoldingRegisters(258, 1, async (err, data) => {
        if (err) {
          console.log(`   ❌ ModBus read failed: ${err.message}`);
          
          if (err.message.includes('Timed out') || err.message.includes('timeout')) {
            console.log(`\n   💡 Port opens but no response from device:`);
            console.log(`      • Verify RS485 wiring (A to A, B to B)`);
            console.log(`      • Check if RS485 connector is properly seated in AlphaESS`);
            console.log(`      • Confirm Slave ID ${slaveId} is correct`);
            console.log(`      • Try: set SLAVE_ID=1 && node test-modbus-rs485.js`);
            console.log(`      • Try different baud rates:`);
            console.log(`        set BAUD_RATE=19200 && node test-modbus-rs485.js`);
            console.log(`        set BAUD_RATE=38400 && node test-modbus-rs485.js`);
            console.log(`      • Check if ModBus needs to be enabled in inverter settings`);
            console.log(`      • Verify the RJ45 pinout matches AlphaESS spec`);
          } else if (err.message.includes('CRC')) {
            console.log(`\n   💡 CRC error - device is responding but communication has issues:`);
            console.log(`      • Try swapping RS485 A and B wires`);
            console.log(`      • Try a different baud rate`);
            console.log(`      • Check cable quality and length`);
            console.log(`      • Verify correct RS485 A/B wiring polarity`);
          }
          
          client.close(() => {});
          resolve({ success: false, error: err.message });
        } else {
          const soc = data.data[0] / 10; // SOC is in 0.1% units
          console.log(`   ✅ ModBus read successful!`);
          console.log(`   📊 Battery SOC: ${soc.toFixed(1)}%`);
          
          // Wait before next command
          await sleep(COMMAND_INTERVAL);
          
          // Try reading voltage
          console.log(`\n   🔍 Reading register 0x0100 (256) - Battery Voltage...`);
          
          client.readHoldingRegisters(256, 1, async (err, data) => {
            if (err) {
              console.log(`   ⚠️  Second read failed: ${err.message}`);
              client.close(() => {});
              resolve({ success: true, data: { soc }, warning: 'partial' });
            } else {
              const voltage = data.data[0] / 10; // Voltage is in 0.1V units
              console.log(`   ✅ Second read successful!`);
              console.log(`   📊 Battery Voltage: ${voltage.toFixed(1)}V`);
              
              // Wait before third read
              await sleep(COMMAND_INTERVAL);
              
              // Try reading PV power
              console.log(`\n   🔍 Reading register 0x0186 (390) - PV Power...`);
              
              client.readHoldingRegisters(390, 1, (err, data) => {
                if (err) {
                  console.log(`   ⚠️  Third read failed: ${err.message}`);
                } else {
                  const pvPower = data.data[0];
                  console.log(`   ✅ Third read successful!`);
                  console.log(`   📊 PV Power: ${pvPower}W`);
                }
                client.close(() => {});
                resolve({ success: true, data: { soc, voltage, pvPower: data?.data[0] || null } });
              });
            }
          });
        }
      });
    });
  });
}

// Main test sequence
async function runTests() {
  // Step 1: List ports
  const ports = await listSerialPorts();
  
  if (!ports || ports.length === 0) {
    return;
  }
  
  console.log(`\n${'='.repeat(65)}`);
  console.log(`Testing serial port: ${SERIAL_PORT}`);
  console.log('='.repeat(65));
  
  // Step 2: Test port opening
  const serialResult = await testSerialPort(SERIAL_PORT);
  
  if (!serialResult.success) {
    console.log(`\n❌ Cannot open COM port - fix this before testing ModBus`);
    console.log(`\n🔧 Try different COM port:`);
    console.log(`   set SERIAL_PORT=COM4 && node test-modbus-rs485.js`);
    console.log(`   set SERIAL_PORT=COM5 && node test-modbus-rs485.js`);
    return;
  }
  
  // Step 3: Test ModBus communication
  const modbusResult = await testModBusRTU(SERIAL_PORT, SLAVE_ID);
  
  if (modbusResult.success) {
    console.log(`\n🎉 SUCCESS! ModBus RS485 is fully working!`);
    console.log(`\n📝 Configuration for WattsOn:`);
    console.log(`   MODBUS_SERIAL_PORT=${SERIAL_PORT}`);
    console.log(`   MODBUS_BAUD_RATE=${BAUD_RATE}`);
    console.log(`   MODBUS_SLAVE_ID=${SLAVE_ID}`);
    console.log(`   COMMAND_INTERVAL=${COMMAND_INTERVAL}ms`);
    console.log(`\n✅ Add these to your WattsOn .env file`);
    
    if (modbusResult.warning === 'partial') {
      console.log(`\n⚠️  Note: First read succeeded but second failed`);
      console.log(`   Consider increasing COMMAND_INTERVAL to 500ms`);
    }
  } else {
    console.log(`\n⚠️  COM port works but ModBus communication failed`);
    console.log(`\n🔧 Quick fixes to try:`);
    console.log(`\n   1. Try different Slave ID:`);
    console.log(`      set SLAVE_ID=1 && node test-modbus-rs485.js`);
    console.log(`\n   2. Try different baud rate:`);
    console.log(`      set BAUD_RATE=19200 && node test-modbus-rs485.js`);
    console.log(`\n   3. Check wiring - swap A and B if you get timeouts`);
    console.log(`\n   4. Verify ModBus is enabled in AlphaESS settings`);
  }
  
  console.log(`\n${'='.repeat(65)}\n`);
}

runTests().catch(console.error);