// probe-solaredge-powercontrol.js
//
// READ-ONLY diagnostic for SolarEdge SE3000H power-control registers.
// This script NEVER writes. There is no writeRegister() call anywhere in it.
//
// Purpose: determine which power-limit mechanism (if any) this inverter
// actually exposes over Modbus TCP, before any curtail UI is built.
//
// Usage:
//   node probe-solaredge-powercontrol.js
//   node probe-solaredge-powercontrol.js 192.168.3.70 1502 1
//
// Note: opens its own TCP connection. The SE3000H tolerates few concurrent
// connections, so if the collector is polling you may see a timeout — just
// rerun, or pause pm2 for the 10 seconds this takes.

import ModbusRTU from 'modbus-serial';

const HOST    = process.argv[2] || '192.168.3.70';
const PORT    = Number(process.argv[3] || 1502);
const UNIT_ID = Number(process.argv[4] || 1);
const TIMEOUT = 5000;

const client = new ModbusRTU();

// ─── Helpers ────────────────────────────────────────────────────────────────

const hex  = v => '0x' + v.toString(16).toUpperCase().padStart(4, '0');
const i16  = v => (v > 0x7FFF ? v - 0x10000 : v);
const line = (s = '') => console.log(s);
const rule = (t) => { line(); line('─'.repeat(72)); line(t); line('─'.repeat(72)); };

/** Read a block. Returns array of uint16, or null if the read failed. */
async function readBlock(addr, count) {
  try {
    const res = await client.readHoldingRegisters(addr, count);
    return res.data;
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

/** Read a block one register at a time, so one bad address doesn't kill the rest. */
async function readEach(addr, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const r = await readBlock(addr + i, 1);
    out.push(Array.isArray(r) ? r[0] : null);
  }
  return out;
}

function dump(startAddr, values, annotate = {}) {
  values.forEach((v, i) => {
    const a = startAddr + i;
    if (v === null || v === undefined) {
      line(`  ${a}   ---- (read failed / unmapped)`);
      return;
    }
    const note = annotate[a] ? `   ← ${annotate[a]}` : '';
    line(`  ${a}   ${String(v).padStart(6)}  ${hex(v)}  int16=${String(i16(v)).padStart(7)}${note}`);
  });
}

// ─── Probe 1: walk the SunSpec model chain ──────────────────────────────────
// This is the definitive test. SunSpec blocks are a linked list:
//   [ModelID][Length][ ...Length registers... ][next ModelID][Length]...
// If Model 123 (Immediate Controls) exists, it will appear in this walk
// and we will learn its real base address. If it does not appear, then
// addresses 40234/40238 in api.js are writing into unmapped or foreign space.

async function walkModelChain() {
  rule('PROBE 1 — SunSpec model chain walk (starting at 40069)');

  let addr = 40069;
  const seen = [];

  for (let step = 0; step < 20; step++) {
    const hdr = await readBlock(addr, 2);
    if (!Array.isArray(hdr)) {
      line(`  ${addr}   chain read failed: ${hdr.error}`);
      break;
    }

    const id  = hdr[0];
    const len = hdr[1];

    // End-of-chain marker per SunSpec spec
    if (id === 0xFFFF) {
      line(`  ${addr}   0xFFFF — end of model chain`);
      break;
    }

    // Sanity: a plausible model header has a small-ish length
    if (!Number.isFinite(len) || len === 0 || len > 400) {
      line(`  ${addr}   ID=${id} L=${len}  ← implausible, chain walk stops here`);
      break;
    }

    const label = ({
      1:   'Common',
      101: 'Inverter, single phase',
      102: 'Inverter, split phase',
      103: 'Inverter, three phase',
      120: 'Nameplate',
      121: 'Basic settings',
      122: 'Measurements/Status',
      123: 'Immediate Controls  ★ THIS IS THE ONE THAT MATTERS',
      124: 'Storage',
      126: 'Static volt-VAR',
      160: 'Multiple MPPT',
      201: 'Meter, single phase',
      203: 'Meter, three phase',
    })[id] || 'unknown / vendor';

    line(`  base=${addr}  ID=${String(id).padStart(3)}  L=${String(len).padStart(3)}  ${label}`);
    seen.push({ id, base: addr, len });

    addr = addr + 2 + len;
  }

  const m123 = seen.find(m => m.id === 123);

  line();
  if (m123) {
    line(`  ✓ Model 123 FOUND at base ${m123.base}.`);
    line(`    Expected field addresses (SunSpec Model 123 layout):`);
    line(`      WMaxLimPct          = ${m123.base + 5}`);
    line(`      WMaxLimPct_WinTms   = ${m123.base + 6}`);
    line(`      WMaxLimPct_RvrtTms  = ${m123.base + 7}   ← hardware revert timer`);
    line(`      WMaxLimPct_RmpTms   = ${m123.base + 8}`);
    line(`      WMaxLim_Ena         = ${m123.base + 9}`);
    line(`    api.js currently writes 40234 (limit) and 40238 (enable),`);
    line(`    which implies base 40229. Compare against the numbers above.`);
  } else {
    line(`  ✗ Model 123 NOT present in the chain.`);
    line(`    → api.js addresses 40234 / 40238 do not correspond to any`);
    line(`      SunSpec model on this inverter. setPowerLimit() is writing`);
    line(`      into unmapped or foreign register space.`);
  }

  return m123;
}

// ─── Probe 2: raw dump around the addresses api.js currently uses ───────────

async function dumpCurrentAddresses() {
  rule('PROBE 2 — raw dump 40228..40242 (what api.js writes to today)');
  const vals = await readEach(40228, 15);
  dump(40228, vals, {
    40234: 'api.js writes the limit value here',
    40238: 'api.js writes the enable flag here',
  });
  line();
  line('  Interpretation:');
  line('    If 40229 reads 123 and 40230 reads a small length (~24), the');
  line('    model-123 assumption in api.js is correct.');
  line('    If these read 0xFFFF / 0x8000 / garbage, they are unmapped.');
}

// ─── Probe 3: SolarEdge vendor power-control block (0xF000+) ────────────────
// This is the block SolarEdge's own app and their "Power Control Open
// Protocol" application note use. Exact offsets vary by firmware, so we
// dump a range and let the values speak.

async function dumpVendorBlock() {
  rule('PROBE 3 — SolarEdge vendor power-control block 0xF000+ (61440+)');

  line('  61440..61455  (0xF000..0xF00F)');
  dump(61440, await readEach(61440, 16), {
    61440: '0xF000 — commonly RRCR state',
    61441: '0xF001 — commonly Active Power Limit (%)',
    61442: '0xF002 — commonly CosPhi',
  });

  line();
  line('  61696..61701  (0xF100..0xF105)');
  dump(61696, await readEach(61696, 6), {
    61696: '0xF100 — commonly Commit Power Control Settings',
    61697: '0xF101 — commonly Restore Power Control Defaults',
  });

  line();
  line('  61760..61771  (0xF140..0xF14B)');
  dump(61760, await readEach(61760, 12), {
    61760: '0xF140 — commonly AdvancedPwrControlEn (int32)',
  });

  line();
  line('  Interpretation:');
  line('    A plausible reading for 0xF001 is 0..100 (percent), typically 100');
  line('    on an uncurtailed inverter. AdvancedPwrControlEn reading 1 means');
  line('    power control is enabled; 0 means it must be turned on in the');
  line('    installer/SetApp interface before any write will take effect.');
  line('    All-0xFFFF or exceptions here means this firmware does not expose');
  line('    the vendor block over Modbus TCP at all.');
}

// ─── Probe 4: current inverter status ──────────────────────────────────────
// Status 5 = Throttled. If the inverter is already sitting at Throttled,
// something is already limiting it — worth knowing before you add another
// limiter on top.

async function dumpStatus() {
  rule('PROBE 4 — current inverter status and AC power');

  const SE_STATUS = {
    1: 'Off', 2: 'Sleeping', 3: 'Grid Monitoring', 4: 'Producing',
    5: 'Throttled', 6: 'Shutting down', 7: 'Fault', 8: 'Maintenance',
  };

  const p = await readBlock(40083, 1);
  const s = await readBlock(40107, 1);

  if (Array.isArray(p)) line(`  40083  AC power raw = ${i16(p[0])}`);
  if (Array.isArray(s)) {
    const st = s[0];
    line(`  40107  status = ${st}  (${SE_STATUS[st] || 'unknown'})`);
    if (st === 5) {
      line('         ⚠ Inverter reports THROTTLED right now — something is');
      line('           already limiting output. Find out what before adding more.');
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  line();
  line(`SolarEdge power-control probe — READ ONLY, no writes performed`);
  line(`Target: ${HOST}:${PORT} unit ${UNIT_ID}`);

  try {
    await client.connectTCP(HOST, { port: PORT });
    client.setID(UNIT_ID);
    client.setTimeout(TIMEOUT);
    line('Connected.');
  } catch (err) {
    line(`✗ Could not connect: ${err.message}`);
    line('  If the collector is polling, pause it and retry.');
    process.exit(1);
  }

  try {
    await walkModelChain();
    await dumpCurrentAddresses();
    await dumpVendorBlock();
    await dumpStatus();
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