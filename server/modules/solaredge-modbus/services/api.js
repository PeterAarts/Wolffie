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

// Fallback scale factors for SE3000H firmware that returns sentinel SF registers.
// Derived from live hardware measurements on SE3000H-RW000BEN4.
const SF_FALLBACK = {
  curr:   -2,   // 0075: raw 912 → 9.12 A
  volt:   -1,   // 0082: raw 2538 → 253.8 V
  pow:    -1,   // 0084: raw 27072 → 2707 W
  freq:   -3,   // 0086: raw 49972 → 49.972 Hz
  energy:  0,   // 0095: firmware returns 0 (real) — fallback matches
  temp:   -2,   // 0106: raw 4190 → 41.9 °C
  dcVolt: -1,   // 0099: raw 3929 → 392.9 V
  dcPow:  -1,   // 0101: raw 26973 → 2697 W
};

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
    if (raw >= SUNSPEC_U16_INVALID_ABOVE) return null;
    const v = raw > 0x7FFF ? raw - 0x10000 : raw;
    return v === SUNSPEC_I16_NI ? null : v;
  }

  async _uint32(addr) {
    const res = await this.client.readHoldingRegisters(addr, 2);
    const val = (res.data[0] * 0x10000 + res.data[1]) >>> 0;
    return val >= SUNSPEC_U32_INVALID_ABOVE ? null : val;
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
    const effectiveSf = (sf !== null && sf !== undefined && sf >= -10 && sf <= 10)
      ? sf
      : fbSf;
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

  async setPowerLimit(percentage) {
    const value = Math.round(Math.max(0, Math.min(100, percentage)) * 100);
    await this.writeRegister(40238, 1);
    await this.writeRegister(40234, value);
    console.log(`   ✓ SolarEdge power limit set to ${percentage}%`);
    return true;
  }
}

export default new SolarEdgeAPI();