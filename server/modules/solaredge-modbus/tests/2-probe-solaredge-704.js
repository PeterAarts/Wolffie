// probe-solaredge-704.js
//
// READ-ONLY diagnostic, part 2. No writes. No writeRegister() call exists here.
//
// Probe 1 established:
//   - This SE3000H exposes SunSpec models 101 + 701..713 (modern DER set)
//   - Model 123 does NOT exist — api.js addresses 40234/40238 land inside
//     model 701 (read-only measurement) and are rejected by the inverter
//   - Model 704 "DER AC Controls" at base 40347 (L=65) is the real target
//
// This probe:
//   1. Dumps model 702 (DER Capacity) — contains nameplate WMax
//   2. Dumps model 704 (DER AC Controls) in full, indexed by offset,
//      so fields can be mapped against the official model_704.json
//   3. Re-reads the SolarEdge vendor block using CORRECT data widths.
//      Probe 1 read single registers, which throws on int32/float32
//      fields — those "read failed" lines were a bug in the probe,
//      not evidence of unmapped registers.
//
// Usage:
//   node probe-solaredge-704.js
//   node probe-solaredge-704.js 192.168.3.70 1502 1

import ModbusRTU from 'modbus-serial';

const HOST    = process.argv[2] || '192.168.3.70';
const PORT    = Number(process.argv[3] || 1502);
const UNIT_ID = Number(process.argv[4] || 1);
const TIMEOUT = 5000;

const M702_BASE = 40276;
const M702_LEN  = 50;
const M704_BASE = 40347;
const M704_LEN  = 65;

const client = new ModbusRTU();

// ─── Helpers ────────────────────────────────────────────────────────────────

const hex  = v => '0x' + v.toString(16).toUpperCase().padStart(4, '0');
const i16  = v => (v > 0x7FFF ? v - 0x10000 : v);
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

/** uint16 */
async function readU16(addr) {
  const d = await readRegs(addr, 1);
  return Array.isArray(d) ? { ok: true, value: d[0] } : { ok: false, error: d.error };
}

/** int32, big-endian register order (SunSpec / SolarEdge convention) */
async function readI32(addr) {
  const d = await readRegs(addr, 2);
  if (!Array.isArray(d)) return { ok: false, error: d.error };
  const raw = (d[0] * 0x10000 + d[1]) >>> 0;
  return { ok: true, value: raw > 0x7FFFFFFF ? raw - 0x100000000 : raw, raw };
}

/** float32 — SolarEdge vendor block uses little-endian register order here,
 *  so try both and report both. Whichever looks sane is the right one. */
async function readF32(addr) {
  const d = await readRegs(addr, 2);
  if (!Array.isArray(d)) return { ok: false, error: d.error };

  const be = Buffer.alloc(4);
  be.writeUInt16BE(d[0], 0); be.writeUInt16BE(d[1], 2);

  const le = Buffer.alloc(4);
  le.writeUInt16BE(d[1], 0); le.writeUInt16BE(d[0], 2);

  return {
    ok: true,
    bigEndian:    be.readFloatBE(0),
    littleEndian: le.readFloatBE(0),
    regs: d,
  };
}

/**
 * Dump a SunSpec block indexed by offset from the model's ID register.
 * Offset 0 = ModelID, offset 1 = Length, offset 2 = first data field.
 * The official model_7xx.json lists fields in this same order, so the
 * offset column maps directly onto the spec's field list.
 */
function dumpBlock(base, regs) {
  regs.forEach((v, i) => {
    const addr = base + i;
    const off  = i;
    const sv   = i16(v);

    // Flag values that look like scale factors or enable flags
    let hint = '';
    if (v === 0xFFFF)              hint = '  (0xFFFF — not implemented, or SF -1)';
    else if (v === 0x8000)         hint = '  (0x8000 — int16 not implemented)';
    else if (sv >= -10 && sv < 0)  hint = '  (plausible scale factor)';
    else if (v === 0 || v === 1)   hint = '  (plausible enable flag / zero)';
    else if (v === 100)            hint = '  (plausible 100% limit)';
    else if (v === 10000)          hint = '  (plausible 100.00% with SF -2)';

    line(
      `  off ${String(off).padStart(3)}  addr ${addr}  ` +
      `${String(v).padStart(6)}  ${hex(v)}  int16=${String(sv).padStart(7)}${hint}`
    );
  });
}

// ─── Probe A: model 702 (DER Capacity) — nameplate WMax ─────────────────────

async function probe702() {
  rule('PROBE A — Model 702 "DER Capacity" @ 40276, L=50');
  line('  WMaxLimPct in model 704 is a percentage OF the nameplate WMax');
  line('  declared here. Look for a value near 3000 (W) or 30 with SF 2.');
  line();

  const regs = await readRegs(M702_BASE, M702_LEN + 2);
  if (!Array.isArray(regs)) {
    line(`  ✗ block read failed: ${regs.error}`);
    return;
  }
  if (regs[0] !== 702) {
    line(`  ⚠ offset 0 reads ${regs[0]}, expected 702 — base address may be wrong`);
  }
  dumpBlock(M702_BASE, regs);
}

// ─── Probe B: model 704 (DER AC Controls) — the real target ─────────────────

async function probe704() {
  rule('PROBE B — Model 704 "DER AC Controls" @ 40347, L=65  ★ THE TARGET');
  line('  Cross-reference the offset column against model_704.json from the');
  line('  SunSpec models repo. Fields to locate:');
  line('    WMaxLimPct      — active power limit, % of WMax');
  line('    WMaxLimPctRvrt  — value to revert to when the timer expires');
  line('    WMaxLimRvrtTms  — revert timeout in seconds  ← hardware fail-safe');
  line('    WMaxLimEna      — 0 = disabled, 1 = enabled');
  line('    WMaxLimPct_SF   — scale factor for the percentage fields');
  line();

  const regs = await readRegs(M704_BASE, M704_LEN + 2);
  if (!Array.isArray(regs)) {
    line(`  ✗ block read failed: ${regs.error}`);
    line('    If this fails as a block, the inverter may cap read length.');
    line('    Rerun reading in two halves before concluding anything.');
    return;
  }
  if (regs[0] !== 704) {
    line(`  ⚠ offset 0 reads ${regs[0]}, expected 704 — base address may be wrong`);
  }
  dumpBlock(M704_BASE, regs);

  line();
  line('  Sanity checks to apply by eye:');
  line('    - Exactly one offset should read 704 (offset 0) and one 65 (offset 1)');
  line('    - The enable flag should currently read 0 (no limit active)');
  line('    - The limit percentage should read 100 or 10000 (uncurtailed)');
  line('    - A run of small negative values near the end = scale factor group');
}

// ─── Probe C: vendor block, correct data widths ─────────────────────────────

async function probeVendor() {
  rule('PROBE C — SolarEdge vendor block, read with correct widths');
  line('  Probe 1 read these one register at a time, which throws on');
  line('  int32/float32 fields. Those "read failed" lines were a probe bug.');
  line();

  // Contiguous block read first — often succeeds where single reads fail
  line('  Block read 61440..61471 (0xF000..0xF01F):');
  const blk = await readRegs(61440, 32);
  if (Array.isArray(blk)) {
    blk.forEach((v, i) => {
      line(`    ${61440 + i}  ${String(v).padStart(6)}  ${hex(v)}`);
    });
  } else {
    line(`    ✗ block read failed: ${blk.error}`);
  }

  line();
  line('  Typed reads:');

  const f000 = await readU16(61440);
  line(`    0xF000 61440  RRCR state (uint16)        : ` +
       (f000.ok ? f000.value : `✗ ${f000.error}`));

  const f001 = await readU16(61441);
  line(`    0xF001 61441  Active Power Limit % (u16) : ` +
       (f001.ok ? f001.value : `✗ ${f001.error}`));

  const f002 = await readF32(61442);
  line(`    0xF002 61442  CosPhi (float32)           : ` +
       (f002.ok
         ? `BE=${f002.bigEndian}  LE=${f002.littleEndian}  regs=[${f002.regs}]`
         : `✗ ${f002.error}`));

  const f100 = await readU16(61696);
  line(`    0xF100 61696  Commit settings (uint16)   : ` +
       (f100.ok ? f100.value : `✗ ${f100.error}`));

  const f101 = await readU16(61697);
  line(`    0xF101 61697  Restore defaults (uint16)  : ` +
       (f101.ok ? f101.value : `✗ ${f101.error}`));

  const f140 = await readI32(61760);
  line(`    0xF140 61760  AdvancedPwrControlEn (i32) : ` +
       (f140.ok
         ? `${f140.value}   ${f140.value === 1 ? '← ENABLED' : '← DISABLED (must be turned on in SetApp)'}`
         : `✗ ${f140.error}`));

  const f142 = await readI32(61762);
  line(`    0xF142 61762  (int32)                    : ` +
       (f142.ok ? f142.value : `✗ ${f142.error}`));

  line();
  line('  If AdvancedPwrControlEn reads 0, no write to any power-limit');
  line('  register will take effect until it is enabled on the inverter');
  line('  itself — that is a SetApp trip, not a code change.');
}

// ─── Probe D: status ────────────────────────────────────────────────────────

async function probeStatus() {
  rule('PROBE D — current status');
  const SE_STATUS = {
    1: 'Off', 2: 'Sleeping', 3: 'Grid Monitoring', 4: 'Producing',
    5: 'Throttled', 6: 'Shutting down', 7: 'Fault', 8: 'Maintenance',
  };
  const p = await readU16(40083);
  const s = await readU16(40107);
  if (p.ok) line(`  40083  AC power raw = ${i16(p.value)}`);
  if (s.ok) line(`  40107  status = ${s.value}  (${SE_STATUS[s.value] || 'unknown'})`);
  line();
  line('  Note: a limit cannot be verified against an inverter producing 0 W.');
  line('  Any eventual write test must happen in daylight, at real output.');
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  line();
  line('SolarEdge Model 704 probe — READ ONLY, no writes performed');
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
    await probe702();
    await probe704();
    await probeVendor();
    await probeStatus();
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