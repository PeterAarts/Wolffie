// test-curtail-write.js
//
// ⚠ THIS SCRIPT WRITES TO THE INVERTER. It writes exactly one register:
//   0xF322 (62242) — Dynamic Active Power Limit, Float32, percent.
//
// This register is explicitly documented as a DYNAMIC command:
//   "This is a dynamic command that does not require any reset. The value is
//    not saved and when the inverter restarts, the command has to be
//    re-entered."
// Not saved = not written to flash. No flash-wear concern, and the value
// evaporates on inverter restart.
//
// SAFETY — three independent layers:
//   1. The script restores 100% in a finally block.
//   2. If the script is killed mid-test, the inverter's own watchdog restores
//      production: 0xF310 Command Timeout = 380s, 0xF312 Fall-back = 100%.
//      Worst case you lose partial production for ~6 minutes.
//   3. The inverter restarts at 100% regardless, since the value isn't saved.
//
// It does NOT write F104/F142/F100 — the probe confirmed those are already
// correct (4 / 1 / 0), so no committed-block change is needed.
//
// Usage:
//   node test-curtail-write.js              # limit to 400 W for 90 s
//   node test-curtail-write.js 400 120      # 400 W for 120 s
//   node test-curtail-write.js 192.168.3.70 1502 1 400 120
//
// RUN THIS IN DAYLIGHT, while the inverter is producing well above the
// target limit. A limit above current output proves nothing.

import ModbusRTU from 'modbus-serial';

// ─── Args ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let HOST = '192.168.3.70', PORT = 1502, UNIT = 1, TARGET_W = 400, HOLD_S = 90;

if (args.length >= 5) {
  [HOST, PORT, UNIT, TARGET_W, HOLD_S] = [args[0], +args[1], +args[2], +args[3], +args[4]];
} else if (args.length >= 1) {
  TARGET_W = +args[0];
  if (args[1]) HOLD_S = +args[1];
}

// ─── Addresses ──────────────────────────────────────────────────────────────

const F300 = 62208;  // Enable Dynamic Power Control   uint16
const F304 = 62212;  // Max Active Power               float32  R
const F30C = 62220;  // Active Power Limit (base)      float32
const F310 = 62224;  // Command Timeout (sec)          uint32
const F312 = 62226;  // Fall-back Active Power Limit   float32 %
const F322 = 62242;  // Dynamic Active Power Limit     float32 %   ← the only write
const AC_POWER = 40083;
const POW_SF   = 40084;
const STATUS   = 40107;

const client = new ModbusRTU();
const line = (s = '') => console.log(s);
const rule = t => { line(); line('─'.repeat(74)); line(t); line('─'.repeat(74)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Float32 codec — LOW WORD FIRST (confirmed via CosPhi = 1.0) ────────────

function decodeF32(regs) {
  const b = Buffer.alloc(4);
  b.writeUInt16BE(regs[1], 0);   // high word is the SECOND register
  b.writeUInt16BE(regs[0], 2);   // low word is the FIRST register
  return b.readFloatBE(0);
}

function encodeF32(value) {
  const b = Buffer.alloc(4);
  b.writeFloatBE(value, 0);
  const hi = b.readUInt16BE(0);
  const lo = b.readUInt16BE(2);
  return [lo, hi];               // register order: low word first
}

// ─── Reads ──────────────────────────────────────────────────────────────────

async function readF32(addr) {
  const r = await client.readHoldingRegisters(addr, 2);
  return decodeF32(r.data);
}

async function readU16(addr) {
  const r = await client.readHoldingRegisters(addr, 1);
  return r.data[0];
}

async function readU32(addr) {
  const r = await client.readHoldingRegisters(addr, 2);
  return (r.data[1] * 0x10000 + r.data[0]) >>> 0;   // low word first
}

/** AC power, reported under BOTH candidate scale factors (SF_FALLBACK.pow
 *  is -2 in api.js but its own doc comment says -1 — unresolved 10x). */
async function readPower() {
  const raw16 = await readU16(AC_POWER);
  const raw   = raw16 > 0x7FFF ? raw16 - 0x10000 : raw16;
  const sf16  = await readU16(POW_SF);
  const sfSigned = sf16 > 0x7FFF ? sf16 - 0x10000 : sf16;
  const sfLive = (sfSigned === -32768) ? null : sfSigned;
  return {
    raw,
    sfLive,
    wSf1: raw * 0.1,     // SF = -1
    wSf2: raw * 0.01,    // SF = -2
  };
}

function fmtPower(p) {
  return `raw=${String(p.raw).padStart(6)}  →  ${String(p.wSf1.toFixed(0)).padStart(5)} W (SF-1)` +
         ` | ${String(p.wSf2.toFixed(0)).padStart(5)} W (SF-2)`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

let wroteLimit = false;

async function main() {
  line();
  line('⚠  SolarEdge curtailment WRITE TEST');
  line(`   Target: ${HOST}:${PORT} unit ${UNIT}`);
  line(`   Will limit to ${TARGET_W} W for ${HOLD_S}s, then restore to 100%.`);

  await client.connectTCP(HOST, { port: PORT });
  client.setID(UNIT);
  client.setTimeout(5000);
  line('   Connected.');

  // ── Preconditions ────────────────────────────────────────────────────────
  rule('STEP 1 — preconditions');

  const status = await readU16(STATUS);
  const SE = { 1:'Off', 2:'Sleeping', 3:'Grid Monitoring', 4:'Producing',
               5:'Throttled', 6:'Shutting down', 7:'Fault', 8:'Maintenance' };
  line(`  Inverter status       : ${status} (${SE[status] || 'unknown'})`);

  const enabled  = await readU16(F300);
  const maxW     = await readF32(F304);
  const baseW    = await readF32(F30C);
  const timeout  = await readU32(F310);
  const fallback = await readF32(F312);
  const limitNow = await readF32(F322);

  line(`  F300 Dynamic control  : ${enabled}   ${enabled === 1 ? '✓ armed' : '✗ NOT ARMED'}`);
  line(`  F304 Max Active Power : ${maxW} W`);
  line(`  F30C Base for F322 %  : ${baseW} W`);
  line(`  F310 Command Timeout  : ${timeout} s`);
  line(`  F312 Fall-back limit  : ${fallback} %`);
  line(`  F322 Current limit    : ${limitNow} %`);

  if (enabled !== 1) {
    throw new Error('F300 is not 1 — dynamic power control is not armed. Aborting.');
  }
  if (!(baseW > 0)) {
    throw new Error(`F30C base is ${baseW} — cannot compute a percentage. Aborting.`);
  }
  if (fallback !== 100) {
    line(`  ⚠ Fall-back is ${fallback}%, not 100%. If this script dies, the`);
    line(`    inverter reverts to ${fallback}%, not full production.`);
  }
  if (status !== 4) {
    throw new Error(`Inverter is not Producing (status ${status}). ` +
                    'A limit cannot be verified against zero output. Aborting.');
  }

  const before = await readPower();
  line(`  AC power now          : ${fmtPower(before)}`);

  if (before.raw * 0.1 < TARGET_W) {
    line();
    line(`  ⚠ Output may already be at or below ${TARGET_W} W.`);
    line('    Under SF-1 the reading is ' + before.wSf1.toFixed(0) + ' W.');
    line('    If production is below the target, this test proves nothing —');
    line('    rerun at higher output, or lower the target.');
  }

  // ── The write ────────────────────────────────────────────────────────────
  const pct = (TARGET_W / baseW) * 100;

  rule(`STEP 2 — writing F322 = ${pct.toFixed(3)} %  (${TARGET_W} W of ${baseW} W)`);

  const regs = encodeF32(pct);
  line(`  Encoded float32 (low word first): [${regs[0]}, ${regs[1]}]`);

  await client.writeRegisters(F322, regs);
  wroteLimit = true;
  line('  Write issued.');

  const readback = await readF32(F322);
  line(`  Read-back F322        : ${readback} %`);

  if (Math.abs(readback - pct) > 0.5) {
    line('  ✗ READ-BACK MISMATCH — the inverter did not accept the value.');
    line('    Restoring and aborting.');
    return;
  }
  line('  ✓ Read-back matches. The inverter accepted the limit.');

  // ── Observe ──────────────────────────────────────────────────────────────
  rule(`STEP 3 — observing for ${HOLD_S}s (sampling every 10s)`);
  line('  Expect output to fall toward the target. Ramp is not instant.');
  line();

  const samples = Math.max(1, Math.floor(HOLD_S / 10));
  for (let i = 0; i < samples; i++) {
    await sleep(10000);
    const p = await readPower();
    const st = await readU16(STATUS);
    line(`  t+${String((i + 1) * 10).padStart(3)}s  ${fmtPower(p)}  status=${st}` +
         (st === 5 ? '  ← THROTTLED ✓' : ''));
  }

  line();
  line('  Status 5 (Throttled) during this window is the definitive');
  line('  confirmation that the inverter is honouring the limit.');
}

// ─── Restore, always ────────────────────────────────────────────────────────

async function restore() {
  if (!client.isOpen) return;
  rule('STEP 4 — restoring F322 = 100 %');
  try {
    await client.writeRegisters(F322, encodeF32(100));
    const back = await readF32(F322);
    line(`  Read-back F322        : ${back} %  ${back === 100 ? '✓' : '✗ NOT RESTORED'}`);

    await sleep(5000);
    const p  = await readPower();
    const st = await readU16(STATUS);
    line(`  AC power after restore: ${fmtPower(p)}  status=${st}`);

    if (back !== 100) {
      line();
      line('  ⚠ RESTORE FAILED. The inverter watchdog (F310 = 380s) will');
      line('    return it to the F312 fall-back on its own. Verify in the');
      line('    SolarEdge app that production resumes within ~6 minutes.');
    }
  } catch (e) {
    line(`  ✗ Restore threw: ${e.message}`);
    line('    The inverter watchdog will restore production within ~380s.');
  }
}

process.on('SIGINT', async () => {
  line();
  line('Interrupted — restoring before exit.');
  await restore();
  try { client.close(() => process.exit(1)); } catch { process.exit(1); }
});

(async () => {
  try {
    await main();
  } catch (e) {
    line();
    line(`✗ ${e.message}`);
  } finally {
    if (wroteLimit) await restore();
    rule('Done.');
    await new Promise(r => { try { client.close(r); } catch { r(); } });
    process.exit(0);
  }
})();