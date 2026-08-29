#!/usr/bin/node

/**
 * Wolffie — SolarEdge Proprietary Block Differential Scan
 *
 * We've been guessing addresses (40234/40238) for the power-limit
 * control, and the last read-back (40238=65534, 40234=0) doesn't match
 * anything we tried to write — suggesting those may just be the wrong
 * registers, not a function-code issue.
 *
 * Instead of guessing again, this uses the one control path already
 * confirmed working — the inverter's local web UI — as ground truth:
 *
 *   1. Snapshot the entire 701–713 vendor block range (read-only)
 *   2. YOU change the power limit via the local web UI to something
 *      clearly different from its current value (e.g. 25%)
 *   3. Snapshot the same range again
 *   4. Diff the two — whatever register(s) changed value IS the real
 *      power-limit register, empirically, no guessing required
 *
 * Fully read-only. No writes anywhere in this script.
 *
 * Usage: node test_solaredge_diff_scan.js
 */

import ModbusRTU from 'modbus-serial';

const SE_HOST     = '192.168.3.70';
const SE_PORT     = 1502;
const SE_UNIT_ID  = 1;
const CHUNK_SIZE  = 100; // stay safely under typical 125-register Modbus read limit

// Range covering vendor blocks 701–713, from the earlier model-chain walk:
// Model 701 starts at 40121, Model 713 ends at 41099 (end marker address).
const SCAN_START = 40121;
const SCAN_END   = 41099; // exclusive

const client = new ModbusRTU();

async function readRange(start, end) {
  const values = {};
  for (let addr = start; addr < end; addr += CHUNK_SIZE) {
    const count = Math.min(CHUNK_SIZE, end - addr);
    try {
      const res = await client.readHoldingRegisters(addr, count);
      res.data.forEach((val, i) => { values[addr + i] = val; });
    } catch (err) {
      console.log(`  ⚠️  Chunk read failed at ${addr} (${count} regs): ${err.message}`);
    }
  }
  return values;
}

function waitForEnter(promptText) {
  return new Promise((resolve) => {
    process.stdout.write(`\n${promptText}`);
    process.stdin.once('data', () => resolve());
  });
}

async function main() {
  console.log('='.repeat(75));
  console.log('🔬  SOLAREDGE PROPRIETARY BLOCK DIFFERENTIAL SCAN');
  console.log('='.repeat(75));
  console.log(`Scanning ${SCAN_START}–${SCAN_END} (${SCAN_END - SCAN_START} registers) in chunks of ${CHUNK_SIZE}\n`);

  await client.connectTCP(SE_HOST, { port: SE_PORT });
  client.setID(SE_UNIT_ID);
  client.setTimeout(4000);
  console.log(`✅ Connected to ${SE_HOST}:${SE_PORT}\n`);

  console.log('── Snapshot A (before change) ──────────────────────────────────');
  const before = await readRange(SCAN_START, SCAN_END);
  console.log(`  Captured ${Object.keys(before).length} registers.`);

  await waitForEnter(
    'Now change the power limit via the inverter\'s LOCAL WEB UI to a clearly\n' +
    'different value (e.g. if it\'s at 100%, set it to 25%). Wait for the\n' +
    'change to visibly apply (~1 min, per your earlier observation), then\n' +
    'press ENTER here to take the second snapshot...'
  );

  console.log('\n── Snapshot B (after change) ───────────────────────────────────');
  const after = await readRange(SCAN_START, SCAN_END);
  console.log(`  Captured ${Object.keys(after).length} registers.`);

  console.log('\n' + '='.repeat(75));
  console.log('DIFF — registers whose value changed between snapshots');
  console.log('='.repeat(75));

  let changedCount = 0;
  for (const addr of Object.keys(before)) {
    const b = before[addr];
    const a = after[addr];
    if (a !== undefined && a !== b) {
      changedCount++;
      console.log(`  🎯 ${addr}   before=${String(b).padStart(6)}  after=${String(a).padStart(6)}   (hex: 0x${b.toString(16).padStart(4,'0')} → 0x${a.toString(16).padStart(4,'0')})`);
    }
  }

  if (changedCount === 0) {
    console.log('  (no registers changed — either the UI change didn\'t take effect yet,');
    console.log('   the change was too small to distinguish, or the control lives outside');
    console.log('   this scanned range entirely)');
  } else {
    console.log(`\n  ${changedCount} register(s) changed. Whichever one moved in a way that`);
    console.log(`  correlates with your % change (e.g. dropped as you lowered the limit)`);
    console.log(`  is very likely the real power-limit register.`);
  }
  console.log('='.repeat(75));

  try { client.close(); } catch (_) {}
  console.log('\n🔌 Connection closed.');
  process.stdin.destroy();
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Scan failed:', err.message);
  process.exit(1);
});