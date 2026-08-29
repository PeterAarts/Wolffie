#!/usr/bin/node

/**
 * Wolffie — Read Current Power-Limit Register Values
 *
 * Purely read-only. Run this WHILE the local web UI still shows the
 * current (3%?) limit, so we get a real "raw value = displayed %"
 * calibration point before restoring to 100%. Run it again after
 * restoring, and we'll have two points to work out the actual scaling —
 * setPowerLimit()'s assumption (percentage × 100) may not be correct.
 *
 * Usage: node test_solaredge_read_limit.js
 */

import ModbusRTU from 'modbus-serial';

const SE_HOST    = '192.168.3.70';
const SE_PORT    = 1502;
const SE_UNIT_ID = 1;

const client = new ModbusRTU();

async function readReg(addr, label) {
  const res = await client.readHoldingRegisters(addr, 1);
  const val = res.data[0];
  console.log(`  ${label.padEnd(30)} addr=${addr}  raw=${String(val).padStart(6)}  hex=0x${val.toString(16).padStart(4, '0')}`);
  return val;
}

async function main() {
  console.log('='.repeat(70));
  console.log('📖  SOLAREDGE POWER-LIMIT REGISTER READ (read-only)');
  console.log('='.repeat(70));

  await client.connectTCP(SE_HOST, { port: SE_PORT });
  client.setID(SE_UNIT_ID);
  client.setTimeout(4000);
  console.log(`Connected to ${SE_HOST}:${SE_PORT}\n`);

  await readReg(40238, '40238 (enable flag?)');
  await readReg(40234, '40234 (limit value?)');

  console.log('\nNote what the local web UI shows right now (e.g. "3%") next to');
  console.log('the raw value above — that\'s our first calibration point.');
  console.log('Run this again after restoring to 100% for the second one.');

  try { client.close(); } catch (_) {}
  console.log('\n🔌 Connection closed.');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Read failed:', err.message);
  process.exit(1);
});