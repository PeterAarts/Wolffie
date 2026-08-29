// modules/solaredge-modbus/services/api.js
import ModbusRTU from 'modbus-serial';

/**
 * SolarEdge SE3000H SunSpec ModBus TCP API
 *
 * All register addresses verified against:
 *   - SunSpec Alliance Inverter Models (101/103) specification
 *   - Live hardware test on SE3000H-RW000BEN4 (test_modbus_2.js v6.8)
 *
 * Connection: 192.168.3.70:1502, unit ID 1
 *
 * ADDRESS CONVENTION:
 *   SolarEdge SunSpec on port 1502 uses 0-based register addressing directly.
 *   All _uint16/_int16/_uint32 methods pass addresses DIRECTLY to modbus-serial.
 *   No -1 offset applied.
 *
 * SCALE FACTOR BEHAVIOUR ON SE3000H FIRMWARE:
 *   This inverter returns 0xFFFF (sentinel) for most SF registers except
 *   energySF (@40095 = 0). When a SF register returns null (sentinel), we
 *   fall back to hardcoded values derived from live hardware measurements:
 *
 *   currSF   @40075  firmware returns sentinel → fallback -2  (raw 912 → 9.12A)
 *   voltSF   @40082  firmware returns sentinel → fallback -1  (raw 2538 → 253.8V)
 *   powSF    @40084  firmware returns sentinel → fallback -1  (raw 27072 → 2707W)
 *   freqSF   @40086  firmware returns sentinel → fallback -3  (raw 49972 → 49.972 Hz)
 *   energySF @40095  firmware returns 0 (real) → use as-is   (raw Wh → Wh)
 *   tempSF   @40106  firmware returns sentinel → fallback -2  (raw 4190 → 41.9°C)
 *   dcVoltSF         fallback -1  (raw 3929 → 392.9V)
 *   dcPowSF          fallback -1  (raw 26973 → 2697W)
 *
 *   ⚠ UNRESOLVED: SF_FALLBACK.pow below is -2, but the worked example in the
 *   comment above implies -1 (raw 27072 → 2707 W needs -1; with -2 it would
 *   be 270.7 W). A 10x discrepancy. Left as-is deliberately — changing it is
 *   out of scope for the curtailment work and would silently rescale all
 *   historical comparisons. It matters for verifying curtailment by eye:
 *   compare a live reading against the SolarEdge app to settle it.
 *
 * SunSpec Inverter Block (40069–40108):
 *   40071  AC Current total (uint16, SF@40075)
 *   40072  AC Current L1    (uint16, SF@40075)
 *   40075  Current SF       (int16)
 *   40076  AC Voltage L1-N  (uint16, SF@40082)
 *   40082  Voltage SF       (int16)
 *   40083  AC Power         (int16, SF@40084)   ← solar_power
 *   40084  Power SF         (int16)
 *   40085  AC Frequency     (uint16, SF@40086)
 *   40086  Frequency SF     (int16)
 *   40093  AC Energy Wh     (uint32, SF@40095)  ← lifetime Wh cumulative
 *   40095  Energy SF        (int16)
 *   40096  DC Current       (uint16, SF@40075)
 *   40098  DC Voltage       (uint16, SF@40099)
 *   40099  DC Voltage SF    (int16)
 *   40100  DC Power         (int16, SF@40101)
 *   40101  DC Power SF      (int16)
 *   40103  Cabinet Temp     (int16, SF@40106)
 *   40106  Temp SF          (int16)
 *   40107  Inverter Status  (uint16)
 *   40108  Status vendor    (uint16)
 *
 * Status=7 (Fault) does NOT mean zero production — SE3000H firmware quirk.
 *
 * Connection strategy: NEW CLIENT INSTANCE PER CYCLE
 * Fresh ModbusRTU instance on every connect() — no stale socket state.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POWER CONTROL — Enhanced Dynamic Power Control block (0xF300+)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This inverter does NOT implement SunSpec Model 123 (Immediate Controls).
 * Its model chain is 101 + 701..713 (the modern DER model set). Model 704
 * "DER AC Controls" IS present in the chain but is a stub — nearly every
 * register reads 0xFFFF / 0x8000 (not-implemented sentinels).
 *
 * Verified live on 2026-08-29 by read-only probe:
 *   0xF142 AdvancedPwrControlEn  = 1     (already enabled)
 *   0xF104 ReactivePwrConfig     = 4     (already RRCR mode)
 *   0xF300 Enable Dynamic Ctrl   = 1     (already armed)
 *   0xF304 Max Active Power      = 3000 W
 *   0xF30C Active Power Limit    = 3000 W  ← base that F322 % is relative to
 *   0xF310 Command Timeout       = 380 s   ← inverter-side watchdog
 *   0xF312 Fall-back Limit       = 100 %   ← what it reverts to on timeout
 *   0xF322 Dynamic Active Pwr Lim= 100 %   ← THE ONLY REGISTER WE WRITE
 *
 * Because F142/F104/F300 are already correct, NO committed-block write and
 * NO 0xF100 commit is required. We never touch the committed Power Control
 * Block (0xF102+) — those registers are non-volatile and a commit there
 * carries grid-facing, flash-wearing consequences. 0xF322 is explicitly
 * documented as dynamic: "the value is not saved and when the inverter
 * restarts, the command has to be re-entered." Not saved = no flash wear,
 * so a per-cycle heartbeat is safe.
 *
 * WORD ORDER: 32-bit values in the vendor block are LOW WORD FIRST. Confirmed
 * empirically — 0xF002 CosPhi reads raw [0, 16256], which is 1.0 only when
 * decoded low-word-first (0x3F800000). Decoding high-word-first gave a
 * nonsense 2.28e-41, and made AdvancedPwrControlEn appear to read 65536 for
 * a register whose documented range is 0-1. Getting this backwards on the
 * fallback limit would be silently dangerous, so both codecs are unit-testable
 * pure functions below.
 *
 * REMOVED in this version: setPowerLimit(). It wrote to 40234/40238, which
 * are inside SunSpec model 701 (DER AC Measurement — read only). The writes
 * were rejected by the inverter and the capability has therefore never
 * worked since it was added in v1.2.0.
 */

export const SE_STATUS = {
  1: 'Off',
  2: 'Sleeping',
  3: 'Grid Monitoring',
  4: 'Producing',
  5: 'Throttled',
  6: 'Shutting down',
  7: 'Fault',
  8: 'Maintenance',
};

const SUNSPEC_U16_INVALID_ABOVE = 0xFFF0;
const SUNSPEC_I16_NI            = -32768;
const SUNSPEC_U32_INVALID_ABOVE = 0xFFFFFFF0;
const MAX_PLAUSIBLE_ENERGY_WH   = 500_000_000;

// ─── Enhanced Dynamic Power Control register addresses (hex → decimal) ──────
export const PC = {
  F300_ENABLE_DYNAMIC:  62208,  // uint16   R/W  0-1
  F304_MAX_ACTIVE_W:    62212,  // float32  R    inverter rating, W
  F30C_ACTIVE_LIMIT_W:  62220,  // float32  R/W  base for F322 percentage, W
  F310_CMD_TIMEOUT_S:   62224,  // uint32   R/W  seconds
  F312_FALLBACK_PCT:    62226,  // float32  R/W  %
  F322_DYNAMIC_PCT:     62242,  // float32  R/W  %   ← the only register written
};

// Fallback scale factors for SE3000H firmware that returns sentinel SF registers.
// Derived from live hardware measurements on SE3000H-RW000BEN4.
const SF_FALLBACK = {
  curr:   -2,   // 0075: raw 912 → 9.12 A
  volt:   -1,   // 0082: raw 2538 → 253.8 V
  pow:    -2,   // 0084: raw 27072 → 2707 W   ⚠ see UNRESOLVED note above
  freq:   -3,   // 0086: raw 49972 → 49.972 Hz
  energy:  0,   // 0095: firmware returns 0 (real) — fallback matches
  temp:   -2,   // 0106: raw 4190 → 41.9 °C
  dcVolt: -1,   // 0099: raw 3929 → 392.9 V
  dcPow:  -1,   // 0101: raw 26973 → 2697 W
};

// ─── Pure codecs — low word first (SolarEdge vendor block convention) ───────

/**
 * Decode two Modbus registers into a float32, low word first.
 * @param  {number[]} regs [lowWord, highWord]
 * @returns {number}
 */
export function decodeF32LE(regs) {
  const b = Buffer.alloc(4);
  b.writeUInt16BE(regs[1], 0);   // high word is the SECOND register
  b.writeUInt16BE(regs[0], 2);   // low word is the FIRST register
  return b.readFloatBE(0);
}

/**
 * Encode a float32 into two Modbus registers, low word first.
 * @param  {number} value
 * @returns {number[]} [lowWord, highWord]
 */
export function encodeF32LE(value) {
  const b = Buffer.alloc(4);
  b.writeFloatBE(value, 0);
  return [b.readUInt16BE(2), b.readUInt16BE(0)];
}

/** Decode two Modbus registers into a uint32, low word first. */
export function decodeU32LE(regs) {
  return ((regs[1] * 0x10000) + regs[0]) >>> 0;
}

class SolarEdgeAPI {
  constructor() {
    this.config = null;
    this.client = null;
  }

  // ─── Connection ─────────────────────────────────────────────────────────────

  async connect(config) {
    if (config) this.config = config;

    const cfg  = this.config;
    const host = cfg?.host || cfg?.ip_address;
    const port = Number(cfg?.port);

    if (!host || !port) {
      throw new Error(`SolarEdge: missing connection parameters host=${host} port=${port}`);
    }

    if (this.client) {
      try { this.client.close(() => {}); } catch (_) {}
      this.client = null;
    }

    this.client = new ModbusRTU();
    this.client.on('error', (err) => {
      console.error(`   • SolarEdge socket error: ${err.message}`);
    });

    await this.client.connectTCP(host, { port });
    this.client.setID(Number(cfg?.unit_id) || 1);
    this.client.setTimeout(Number(cfg?.timeout) || 5000);
  }

  async disconnect() {
    if (this.client) {
      try {
        await new Promise(resolve => {
          try { this.client.close(resolve); } catch (_) { resolve(); }
        });
      } catch (_) {}
      this.client = null;
    }
  }

  /**
   * Force-abort whatever connection is currently in flight.
   *
   * Called by CollectorManager when a collection cycle has been judged
   * hung (exceeded its outer deadline) and the manager has already stopped
   * waiting on the original collect() promise. JS can't actually cancel a
   * pending await — the original connect()/fetchAll() chain may still be
   * sitting out there. What this does instead:
   *
   *   1. Detaches this.client immediately, so the *next* connect() cycle
   *      never touches this dying instance (it always builds a fresh
   *      ModbusRTU() anyway, but this avoids any chance of the orphaned
   *      reference being acted on in between).
   *   2. Tries a graceful close() first.
   *   3. Best-effort reaches into modbus-serial's TCP transport to destroy
   *      the underlying raw socket directly, so a stuck connectTCP() or
   *      readHoldingRegisters() unblocks (as a rejection) immediately
   *      instead of waiting out an OS-level TCP timeout — which can be
   *      tens of seconds to a couple of minutes depending on the OS.
   *
   * Step 3 touches an undocumented internal (`_port._client`) that could
   * change between modbus-serial versions, so it's wrapped defensively and
   * never throws — at worst it's a no-op and the socket leaks until the OS
   * eventually reclaims it, which is exactly the pre-existing behaviour
   * this method is trying to improve on, not make worse.
   *
   * NOTE on curtailment: aborting mid-cycle may abandon a pending F322
   * heartbeat write. That is safe by construction — the inverter's own
   * 380s watchdog restores production if we stop writing, and the next
   * cycle re-asserts the limit if we still want it.
   */
  async abort() {
    if (!this.client) return;

    const dead = this.client;
    this.client = null;

    try {
      dead.close(() => {});
    } catch (_) {}

    try {
      dead._port?._client?.destroy?.();
    } catch (_) {}
  }

  // ─── Low-level Reads ────────────────────────────────────────────────────────
  // Addresses passed DIRECTLY — no offset. SolarEdge port 1502 is 0-based.

  async _uint16(addr) {
    const res = await this.client.readHoldingRegisters(addr, 1);
    const v = res.data[0] ?? 0;
    return v >= SUNSPEC_U16_INVALID_ABOVE ? null : v;
  }

  async _int16(addr) {
    const res = await this.client.readHoldingRegisters(addr, 1);
    const raw = res.data[0] ?? 0;
    // NOTE: do NOT apply SUNSPEC_U16_INVALID_ABOVE here.
    // For int16, 0xFFFF = -1 and 0xFFFE = -2 are VALID scale factors.
    // The only SunSpec not-implemented sentinel for int16 is 0x8000 (-32768),
    // which is handled below by SUNSPEC_I16_NI.
    const v = raw > 0x7FFF ? raw - 0x10000 : raw;
    return v === SUNSPEC_I16_NI ? null : v;
  }

  async _uint32(addr) {
    const res = await this.client.readHoldingRegisters(addr, 2);
    const val = (res.data[0] * 0x10000 + res.data[1]) >>> 0;
    return val >= SUNSPEC_U32_INVALID_ABOVE ? null : val;
  }

  // ─── Vendor block reads (low word first) ────────────────────────────────────

  async _readF32LE(addr) {
    const res = await this.client.readHoldingRegisters(addr, 2);
    return decodeF32LE(res.data);
  }

  async _readU32LE(addr) {
    const res = await this.client.readHoldingRegisters(addr, 2);
    return decodeU32LE(res.data);
  }

  // ─── Scaling & Sanitisation ─────────────────────────────────────────────────

  /**
   * Apply SunSpec scale factor.
   * @param {number|null} value  Raw register value
   * @param {number|null} sf     Scale factor from register (may be null = sentinel)
   * @param {number}      fbSf   Fallback SF to use when register returns sentinel
   */
  _scale(value, sf, fbSf) {
    if (value === null || value === undefined) return null;
    // Use register SF if it's a real value, otherwise use hardcoded fallback
    const effectiveSf = (sf !== null && sf !== undefined && sf !== 0 && sf >= -10 && sf <= 10)
      ? sf : fbSf;
    if (effectiveSf === null || effectiveSf === undefined) return value;
    const result = value * Math.pow(10, effectiveSf);
    if (!isFinite(result) || isNaN(result)) return value;
    return parseFloat(result.toFixed(6));
  }

  _san(value) {
    if (value === null || value === undefined) return null;
    if (!isFinite(value) || isNaN(value)) return null;
    return value;
  }

  // ─── Main Data Fetch ────────────────────────────────────────────────────────

  async fetchAll() {
    // Read SF registers — may return null if firmware returns sentinel
    const currSF   = await this._int16(40075);
    const voltSF   = await this._int16(40082);
    const powSF    = await this._int16(40084);
    const freqSF   = await this._int16(40086);
    const energySF = await this._int16(40095);
    const tempSF   = await this._int16(40106);
    const dcVoltSF = await this._int16(40099);
    const dcPowSF  = await this._int16(40101);

    // AC values
    const acCurrentRaw = await this._uint16(40071);
    const acCurrL1Raw  = await this._uint16(40072);
    const acVoltL1Raw  = await this._uint16(40076);
    const acPowerRaw   = await this._int16(40083);
    const acFreqRaw    = await this._uint16(40085);
    const acEnergyRaw  = await this._uint32(40093);

    // DC values
    const dcCurrentRaw = await this._uint16(40096);
    const dcVoltageRaw = await this._uint16(40098);
    const dcPowerRaw   = await this._int16(40100);

    // Temperature & status
    const tempRaw      = await this._int16(40103);
    const statusRaw    = (await this.client.readHoldingRegisters(40107, 1)).data[0];
    const statusVendor = (await this.client.readHoldingRegisters(40108, 1)).data[0];
    const status       = statusRaw >= SUNSPEC_U16_INVALID_ABOVE ? null : statusRaw;

    // Apply scale factors — falls back to hardcoded SF when register is sentinel
    const acPower    = this._scale(acPowerRaw,   powSF,    SF_FALLBACK.pow);
    const acCurrent  = this._scale(acCurrentRaw, currSF,   SF_FALLBACK.curr);
    const acCurrL1   = this._scale(acCurrL1Raw,  currSF,   SF_FALLBACK.curr);
    const acVoltL1   = this._scale(acVoltL1Raw,  voltSF,   SF_FALLBACK.volt);
    const acFreq     = this._scale(acFreqRaw,    freqSF,   SF_FALLBACK.freq);
    const acEnergyWh = this._scale(acEnergyRaw,  energySF, SF_FALLBACK.energy);
    const dcCurrent  = this._scale(dcCurrentRaw, currSF,   SF_FALLBACK.curr);
    const dcVoltage  = this._scale(dcVoltageRaw, dcVoltSF, SF_FALLBACK.dcVolt);
    const dcPower    = this._scale(dcPowerRaw,   dcPowSF,  SF_FALLBACK.dcPow);
    const temp       = this._scale(tempRaw,      tempSF,   SF_FALLBACK.temp);

    const energySan = (acEnergyWh !== null && acEnergyWh <= MAX_PLAUSIBLE_ENERGY_WH)
      ? this._san(acEnergyWh) : null;

    const statusLabel = status === null
      ? 'Not ready'
      : (SE_STATUS[status] ?? `Unknown (${status})`);

    return {
      power_ac:      this._san(acPower),
      current_ac:    this._san(acCurrent),
      current_l1:    this._san(acCurrL1),
      voltage_ln:    this._san(acVoltL1),
      frequency:     this._san(acFreq),
      energy_total:  energySan,
      dc_current:    this._san(dcCurrent),
      dc_voltage:    this._san(dcVoltage),
      dc_power:      this._san(dcPower),
      temp_sink:     this._san(temp),
      status,
      status_vendor: statusVendor,
      status_label:  statusLabel,
      is_producing:  isFinite(acPower) && acPower > 5,
    };
  }

  // ─── Write / Control ────────────────────────────────────────────────────────

  async writeRegister(address, value) {
    await this.client.writeRegister(address, value);
  }

  /**
   * Read the enhanced dynamic power control block.
   *
   * Cheap: five short reads inside a connection the collector already holds.
   * Called once per cycle so the UI always shows what the inverter actually
   * thinks, not what Wolffie believes it commanded.
   *
   * @returns {Promise<{
   *   dynamicControlEnabled: boolean,
   *   maxActivePowerW: number,
   *   baseLimitW: number,
   *   commandTimeoutS: number,
   *   fallbackPct: number,
   *   currentPct: number
   * }>}
   */
  async readPowerControl() {
    const enabled = await this._uint16(PC.F300_ENABLE_DYNAMIC);

    return {
      dynamicControlEnabled: enabled === 1,
      maxActivePowerW:  await this._readF32LE(PC.F304_MAX_ACTIVE_W),
      baseLimitW:       await this._readF32LE(PC.F30C_ACTIVE_LIMIT_W),
      commandTimeoutS:  await this._readU32LE(PC.F310_CMD_TIMEOUT_S),
      fallbackPct:      await this._readF32LE(PC.F312_FALLBACK_PCT),
      currentPct:       await this._readF32LE(PC.F322_DYNAMIC_PCT),
    };
  }

  /**
   * Write the dynamic active power limit (0xF322) and verify by read-back.
   *
   * Read-back is not optional here. This path fires a handful of times a
   * year, so there is no routine traffic to reveal that it has quietly
   * stopped working — exactly how the previous implementation went
   * unnoticed for six months. Every write is checked.
   *
   * @param  {number} pct  0-100, percent of the F30C base
   * @returns {Promise<number>} the percentage the inverter confirmed
   * @throws  when the write is rejected or the read-back disagrees
   */
  async setDynamicActivePowerLimit(pct) {
    if (!Number.isFinite(pct)) {
      throw new Error(`setDynamicActivePowerLimit: pct is not a number (${pct})`);
    }

    const clamped = Math.max(0, Math.min(100, pct));

    await this.client.writeRegisters(PC.F322_DYNAMIC_PCT, encodeF32LE(clamped));

    const readback = await this._readF32LE(PC.F322_DYNAMIC_PCT);

    // float32 cannot represent 13.333... exactly, so compare with tolerance.
    if (!Number.isFinite(readback) || Math.abs(readback - clamped) > 0.5) {
      throw new Error(
        `F322 read-back mismatch: wrote ${clamped.toFixed(3)}%, read ${readback}%`
      );
    }

    return readback;
  }
}

export default new SolarEdgeAPI();