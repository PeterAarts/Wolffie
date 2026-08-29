#!/usr/bin/node

/**
 * Wolffie — SolarEdge Write-Path Isolation Test
 *
 * With pm2 confirmed stopped, setPowerLimit() (FC6 single-register writes
 * to 40238 then 40234) times out with no response — not a Modbus
 * exception, just silence. That pattern is consistent with a control
 * block that only honours writes via FC16 (writeRegisters), even for a
 * single value, and silently drops FC6 instead of returning a proper
 * "illegal function" exception.
 *
 * This isolates two things setPowerLimit() couldn't tell us:
 *   1. WHICH of the two writes (40238 enable-flag, 40234 value) hangs —
 *      could be the very first one, meaning 40234 is never even reached
 *   2. WHETHER switching FC6 → FC16 changes the outcome
 *
 * Each attempt has its own short timeout so one hang doesn't block the
 * rest from being tried and reported.
 *
 * IMPORTANT: if any write here succeeds, it may leave the inverter
 * capped below 100%. Since we're still validating whether Modbus writes
 * are reliable AT ALL, don't chain another Modbus write to "fix" that —
 * restore via the local web UI (the control path already confirmed
 * working) if the final read-back below shows anything other than the
 * unrestricted value.
 *
 * Usage: node test_solaredge_write_path.js
 */

import ModbusRTU from 'modbus-serial';

const SE_HOST          = '192.168.3.70';
const SE_PORT          = 1502;
const SE_UNIT_ID       = 1;
const WRITE_TIMEOUT_MS = 4000; // short on purpose — want fast failure per attempt, not one long hang

const client = new ModbusRTU();

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms)),
  ]);
}

async function tryWrite(label, fn) {
  const start = Date.now();
  try {
    await withTimeout(fn(), WRITE_TIMEOUT_MS, label);
    console.log(`  ✅ ${label.padEnd(42)} OK (${Date.now() - start}ms)`);
    return true;
  } catch (err) {
    console.log(`  ❌ ${label.padEnd(42)} FAILED — ${err.message} (${Date.now() - start}ms)`);
    return false;
  }
}

async function readReg(addr) {
  try {
    const res = await withTimeout(client.readHoldingRegisters(addr, 1), WRITE_TIMEOUT_MS, `read ${addr}`);
    return res.data[0];
  } catch (err) {
    return `ERROR (${err.message})`;
  }
}

async function main() {
  console.log('='.repeat(75));
  console.log('🔬  SOLAREDGE WRITE-PATH ISOLATION TEST');
  console.log('='.repeat(75));
  console.log('⚠️  Confirm pm2 is stopped before running this — contention gives false results.\n');

  console.log(`Connecting to ${SE_HOST}:${SE_PORT} (unit ${SE_UNIT_ID})...`);
  await client.connectTCP(SE_HOST, { port: SE_PORT });
  client.setID(SE_UNIT_ID);
  client.setTimeout(WRITE_TIMEOUT_MS);
  console.log('✅ Connected.\n');

  // ── Baseline reads — zero risk, confirms current state ──────────────
  console.log('  ── Current register values (read-only) ──────────────────────');
  console.log(`  40238 (enable flag?) = ${await readReg(40238)}`);
  console.log(`  40234 (limit value?) = ${await readReg(40234)}`);

  console.log('\n  ── FC6 single-register write (writeRegister) — what setPowerLimit() uses ──');
  await tryWrite('FC6 write 40238 = 1',    () => client.writeRegister(40238, 1));
  await tryWrite('FC6 write 40234 = 5000', () => client.writeRegister(40234, 5000)); // 50% × 100, matches setPowerLimit()'s scaling

  console.log('\n  ── FC16 multi-register write (writeRegisters) — same values, alt function code ──');
  await tryWrite('FC16 write 40238 = [1]',    () => client.writeRegisters(40238, [1]));
  await tryWrite('FC16 write 40234 = [5000]', () => client.writeRegisters(40234, [5000]));

  console.log('\n  ── Final register state (read-only) ──────────────────────────');
  const final238 = await readReg(40238);
  const final234 = await readReg(40234);
  console.log(`  40238 = ${final238}`);
  console.log(`  40234 = ${final234}`);

  console.log('\n' + '='.repeat(75));
  console.log('Whichever attempt(s) show ✅ tell us the correct function code AND');
  console.log('confirm both registers are independently writable.');
  console.log('');
  if (final234 !== 10000 && typeof final234 === 'number' && final234 < 9500) {
    console.log('⚠️  40234 no longer reads as the unrestricted value — a write above likely');
    console.log('   took effect. RESTORE VIA THE LOCAL WEB UI, not another Modbus write,');
    console.log('   since write reliability over Modbus is exactly what\'s still unproven.');
  } else {
    console.log('No restore appears necessary based on the final read-back above —');
    console.log('but visually confirm actual production via the local web UI regardless.');
  }
  console.log('='.repeat(75));

  try { client.close(); } catch (_) {}
  console.log('\n🔌 Connection closed.');
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});