// probe-solaredge-enhanced.js
//
// READ-ONLY diagnostic, part 3. No writes. No writeRegister() call exists here.
//
// Established so far:
//   - Model 123 does not exist; api.js writes to 40234/40238 land in model 701
//     (read-only measurement) and are rejected. solar:curtail has never worked.
//   - Model 704 "DER AC Controls" is present in the chain but is a stub —
//     almost entirely 0xFFFF / 0x8000 not-implemented sentinels.
//   - The SolarEdge vendor block IS live. 0xF001 reads 100 (%), CosPhi at
//     0xF002 decodes to exactly 1.0 when the two registers are word-swapped.
//
// WORD ORDER: the vendor block stores 32-bit values low-word-first. Probe 2
// decoded them high-word-first, which is why AdvancedPwrControlEn appeared to
// read 65536 (impossible for a 0-1 range) rather than 1. This probe decodes
// both ways and labels which is which, so the convention is confirmed rather
// than assumed.
//
// This probe answers two questions:
//   1. What is ReactivePwrConfig (0xF104) set to now? Both control paths
//      require it at 4 (RRCR mode); it defaults to 0. If it already reads 4,
//      the committed-block write is unnecessary and the whole grid-facing
//      concern evaporates.
//   2. Is the Enhanced Dynamic Power Control block (0xF300+) actually
//      implemented on this firmware? The application note is from 2017 and
//      predates the SunSpec 70x models this inverter exposes. Model 704 was
//      documented and still turned out to be a stub — do not assume.
//
// Usage:
//   node probe-solaredge-enhanced.js
//   node probe-solaredge-enhanced.js 192.168.3.70 1502 1

import ModbusRTU from 'modbus-serial';

const HOST    = process.argv[2] || '192.168.3.70';
const PORT    = Number(process.argv[3] || 1502);
const UNIT_ID = Number(process.argv[4] || 1);
const TIMEOUT = 5000;

const client = new ModbusRTU();

// ─── Address map (hex → decimal) ────────────────────────────────────────────
const A = {
  F000: 61440, F001: 61441, F002: 61442,
  F100: 61696, F101: 61697, F102: 61698, F104: 61700, F106: 61702, F108: 61704,
  F140: 61760, F142: 61762, F144: 61764,
  F300: 62208, F301: 62209, F302: 62210, F304: 62212, F306: 62214,
  F308: 62216, F309: 62217, F30A: 62218, F30C: 62220, F30E: 62222,
  F310: 62224, F312: 62226, F314: 62228, F316: 62230,
  F318: 62232, F31A: 62234, F31C: 62236, F31E: 62238, F320: 62240,
  F322: 62242, F324: 62244, F326: 62246,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const hex  = v => '0x' + v.toString(16).toUpperCase().padStart(4, '0');
const line = (s = '') => console.log(s);
const rule = t => { line(); line('─'.repeat(78)); line(t); line('─'.repeat(78)); };

async function readRegs(addr, count) {
  try {
    const res = await client.readHoldingRegisters(addr, count);
    return res.data;
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

/** Decode a 2-register value both ways. LE = low word first (SolarEdge vendor). */
function decode32(regs) {
  const hi = w => Buffer.from([w >> 8, w & 0xFF]);

  const beBuf = Buffer.concat([hi(regs[0]), hi(regs[1])]);
  const leBuf = Buffer.concat([hi(regs[1]), hi(regs[0])]);

  const beU = beBuf.readUInt32BE(0);
  const leU = leBuf.readUInt32BE(0);

  return {
    raw:      `[${regs[0]}, ${regs[1]}]`,
    leInt:    leU > 0x7FFFFFFF ? leU - 0x100000000 : leU,
    beInt:    beU > 0x7FFFFFFF ? beU - 0x100000000 : beU,
    leUint:   leU,
    leFloat:  leBuf.readFloatBE(0),
    beFloat:  beBuf.readFloatBE(0),
    allFFFF:  regs[0] === 0xFFFF && regs[1] === 0xFFFF,
  };
}

async function show32(label, addr, kind /* 'int' | 'uint' | 'float' */, note = '') {
  const d = await readRegs(addr, 2);
  if (!Array.isArray(d)) {
    line(`  ${label.padEnd(34)} ✗ read failed: ${d.error}`);
    return null;
  }
  const v = decode32(d);
  let shown;
  if (kind === 'float')     shown = `LE=${v.leFloat}   (BE=${v.beFloat})`;
  else if (kind === 'uint') shown = `LE=${v.leUint}    (BE=${v.beInt})`;
  else                      shown = `LE=${v.leInt}     (BE=${v.beInt})`;

  const sentinel = v.allFFFF ? '   ⚠ 0xFFFF/0xFFFF — likely NOT IMPLEMENTED' : '';
  line(`  ${label.padEnd(34)} raw=${v.raw.padEnd(16)} ${shown}${sentinel}${note}`);
  return v;
}

async function show16(label, addr, note = '') {
  const d = await readRegs(addr, 1);
  if (!Array.isArray(d)) {
    line(`  ${label.padEnd(34)} ✗ read failed: ${d.error}`);
    return null;
  }
  const v = d[0];
  const sentinel = v === 0xFFFF ? '   ⚠ 0xFFFF — likely NOT IMPLEMENTED' : '';
  line(`  ${label.padEnd(34)} ${String(v).padStart(6)}  ${hex(v)}${sentinel}${note}`);
  return v;
}

// ─── Probe A: word-order confirmation ───────────────────────────────────────

async function probeWordOrder() {
  rule('PROBE A — confirm 32-bit word order using CosPhi (0xF002)');
  line('  CosPhi on an uncurtailed inverter should read exactly 1.0.');
  line('  Whichever decode yields 1.0 is the correct convention.');
  line();
  const v = await show32('0xF002  CosPhi (Float32)', A.F002, 'float');
  line();
  if (v) {
    if (Math.abs(v.leFloat - 1.0) < 0.001) {
      line('  ✓ LITTLE-ENDIAN (low word first) confirmed. All 32-bit values');
      line('    in this block must be decoded low-word-first.');
    } else if (Math.abs(v.beFloat - 1.0) < 0.001) {
      line('  ✓ BIG-ENDIAN confirmed — my earlier conclusion was wrong.');
    } else {
      line('  ⚠ Neither decode gives 1.0. Do not trust any 32-bit value below');
      line('    until this is resolved.');
    }
  }
}

// ─── Probe B: the RRCR prerequisite ─────────────────────────────────────────

async function probePrerequisites() {
  rule('PROBE B — prerequisites for BOTH control paths');
  line('  Per the application note, both simple (0xF001) and enhanced (0xF300)');
  line('  dynamic power control require:');
  line('    AdvancedPwrControlEn (0xF142) = 1');
  line('    ReactivePwrConfig    (0xF104) = 4  (RRCR mode)');
  line('    a Commit (0xF100 = 1) to make committed-block changes effective');
  line();

  await show32('0xF142  AdvancedPwrControlEn (Int32)', A.F142, 'int',
    '   ← want 1');
  const rpc = await show32('0xF104  ReactivePwrConfig (Int32)', A.F104, 'int',
    '   ← want 4 (RRCR)');
  await show32('0xF102  PwrFrqDeratingConfig (Int32)', A.F102, 'int');
  await show32('0xF106  ReactPwrIterTime (Uint32)', A.F106, 'uint');
  await show32('0xF140  PowerReduce (Float32, %)', A.F140, 'float',
    '   ← committed block, DO NOT USE');
  await show16('0xF100  Commit Power Ctrl Settings', A.F100,
    '   ← 0 = last commit OK');
  await show16('0xF101  Restore Defaults', A.F101);

  line();
  if (rpc) {
    if (rpc.leInt === 4) {
      line('  ✓ ReactivePwrConfig already reads 4 (RRCR). No committed-block');
      line('    write is needed — the grid-facing concern is moot.');
    } else {
      line(`  ⚠ ReactivePwrConfig reads ${rpc.leInt}, not 4.`);
      line('    Enabling either control path means writing 0xF104 = 4 and');
      line('    committing via 0xF100. That is a persistent, grid-facing');
      line('    change to reactive power handling on a certified install.');
      line('    0xF101 = 1 restores power-control defaults if it goes wrong.');
    }
  }
}

// ─── Probe C: is the enhanced block implemented? ────────────────────────────

async function probeEnhanced() {
  rule('PROBE C — Enhanced Dynamic Power Control block (0xF300+)  ★ DECIDES THE DESIGN');
  line('  If this block is real, the inverter provides its own watchdog:');
  line('    0xF310 Command Timeout + 0xF312 Fall-back Active Power Limit');
  line('    → set fallback 100%, refresh 0xF322 on a heartbeat, and the');
  line('      inverter restores full production by itself if Wolffie dies.');
  line();
  line('  Raw block read 0xF300..0xF327 (62208..62247):');

  const blk = await readRegs(A.F300, 40);
  if (Array.isArray(blk)) {
    let allSentinel = true;
    blk.forEach((v, i) => {
      if (v !== 0xFFFF) allSentinel = false;
      line(`    ${A.F300 + i}  0x${(0xF300 + i).toString(16).toUpperCase()}  ` +
           `${String(v).padStart(6)}  ${hex(v)}`);
    });
    line();
    if (allSentinel) {
      line('  ✗ Entire block reads 0xFFFF — NOT IMPLEMENTED on this firmware.');
      line('    Same outcome as model 704. Fall back to the simple path.');
    }
  } else {
    line(`    ✗ block read failed: ${blk.error}`);
    line('    A hard exception here is itself evidence the block is absent.');
  }

  line();
  line('  Typed reads:');
  await show16('0xF300  Enable Dynamic Power Control', A.F300, '   ← 0 = off (default)');
  await show32('0xF304  Max Active Power (Float32, W)', A.F304, 'float',
    '   ← expect ~3000');
  await show32('0xF306  Max Reactive Power (Float32)', A.F306, 'float');
  await show16('0xF308  Active/Reactive Preference', A.F308);
  await show16('0xF309  CosPhi/Q Preference', A.F309);
  await show32('0xF30C  Active Power Limit (Float32, W)', A.F30C, 'float');
  await show32('0xF30E  Reactive Power Limit (Float32)', A.F30E, 'float');
  await show32('0xF310  Command Timeout (Uint32, sec)', A.F310, 'uint',
    '   ← the watchdog');
  await show32('0xF312  Fall-back Active Pwr Limit (%)', A.F312, 'float',
    '   ← the fail-safe');
  await show32('0xF318  Active Power Ramp-up (%/min)', A.F318, 'float');
  await show32('0xF31A  Active Power Ramp-down (%/min)', A.F31A, 'float');
  await show32('0xF322  Dynamic Active Power Limit (%)', A.F322, 'float',
    '   ← what we would write');

  line();
  line('  Decision rule:');
  line('    0xF304 reading ~3000 (the SE3000H nameplate) is the strongest');
  line('    single signal that this block is real — the inverter would have');
  line('    to populate a read-only rating register with a true value.');
  line('    If 0xF304 is 0xFFFF/0xFFFF or throws, treat the block as absent');
  line('    regardless of what the other registers do.');
}

// ─── Probe D: simple block + status ─────────────────────────────────────────

async function probeSimple() {
  rule('PROBE D — simple dynamic block (0xF000) and current status');

  await show16('0xF000  RRCR State', A.F000);
  await show16('0xF001  Active Power Limit (%)', A.F001, '   ← simple path target');

  const SE_STATUS = {
    1: 'Off', 2: 'Sleeping', 3: 'Grid Monitoring', 4: 'Producing',
    5: 'Throttled', 6: 'Shutting down', 7: 'Fault', 8: 'Maintenance',
  };
  const p = await readRegs(40083, 1);
  const s = await readRegs(40107, 1);
  line();
  if (Array.isArray(p)) line(`  40083  AC power raw = ${p[0] > 0x7FFF ? p[0] - 0x10000 : p[0]}`);
  if (Array.isArray(s)) line(`  40107  status = ${s[0]}  (${SE_STATUS[s[0]] || 'unknown'})`);

  line();
  line('  Reminder: a power limit cannot be verified against an inverter');
  line('  producing 0 W. The first live write test must happen in daylight.');
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  line();
  line('SolarEdge enhanced power control probe — READ ONLY, no writes performed');
  line(`Target: ${HOST}:${PORT} unit ${UNIT_ID}`);

  try {
    await client.connectTCP(HOST, { port: PORT });
    client.setID(UNIT_ID);
    client.setTimeout(TIMEOUT);
    line('Connected.');
  } catch (err) {
    line(`✗ Could not connect: ${err.message}`);
    process.exit(1);
  }

  try {
    await probeWordOrder();
    await probePrerequisites();
    await probeEnhanced();
    await probeSimple();
  } catch (err) {
    line();
    line(`✗ Probe aborted: ${err.message}`);
  } finally {
    rule('Done — no registers were written.');
    await new Promise(resolve => {
      try { client.close(resolve); } catch { resolve(); }
    });
    process.exit(0);
  }
}

main();