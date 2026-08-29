#!/usr/bin/node

/**
 * Wolffie AlphaESS Comparison & Dispatch Test - v6.8
 *
 * Target  : SMILE G3-T10  +  SolarEdge SE3000H (AC-coupled)
 * Goal    : Read AlphaESS + SolarEdge ModBus side-by-side, then dispatch test
 * Strategy: "Clear and Claim" — Kill active mode before setting new one
 *
 * ── AlphaESS register addresses ─────────────────────────────────────────────
 * Verified against AlphaESS ModBus RTU/TCP Protocol v1.28
 *
 * Dispatch section (0x0880–0x0888):
 *   2176  0x0880  Dispatch Start         unsigned 16-bit   1=start, 0=stop
 *   2177  0x0881  Dispatch Active power  signed 32-bit     1 W/bit, offset 32000
 *   2178  0x0882  (low word of above)
 *   2181  0x0885  Dispatch Mode          unsigned 16-bit   see Note7
 *   2182  0x0886  Dispatch SOC           unsigned 16-bit   0.4 %/bit
 *   2183  0x0887  Dispatch Time          unsigned 32-bit   1 s/bit
 *   2184  0x0888  (low word of above)
 *
 * Note7 — Dispatch Mode values:
 *   1=Charge from PV only  2=SoC control  3=Load following
 *   4=Maximise output      5=Normal       6=Optimise consumption
 *   7=Maximise consumption 8=ECO mode
 *
 * Active power encoding (offset 32000):
 *   Charge   : rawPower = 32000 - watts  (charge < 32000)
 *   Discharge: rawPower = 32000 + watts  (discharge > 32000)
 *
 * ── SolarEdge register addresses ────────────────────────────────────────────
 * SunSpec-compliant SolarEdge ModBus TCP (port 1502, unit ID 1)
 * Base address: 40000 (0x9C40) — SunSpec Common Model + Inverter Model
 *
 * Common Block (40000–40069):
 *   40000  SunSpec ID        "SunS" = 0x53756e53
 *   40002  Common model ID   = 1
 *   40004  Manufacturer      (16 regs, ASCII)
 *   40020  Model             (16 regs, ASCII)
 *   40044  Serial Number     (16 regs, ASCII)
 *   40068  Device address    (1 reg)
 *
 * Inverter Model (40069–40107):
 *   40069  Model ID          101=single-phase, 103=three-phase
 *   40071  AC Total current  (uint16, scale @ 40075)
 *   40072  AC Current L1     (uint16, scale @ 40075)
 *   40075  Current scale     (int16, 10^n)
 *   40076  AC Voltage L1-N   (uint16, scale @ 40082)
 *   40082  Voltage scale     (int16, 10^n)
 *   40083  AC Power          (int16, scale @ 40084)  ← key production value
 *   40084  Power scale       (int16, 10^n)
 *   40085  AC Frequency      (uint16, scale @ 40086)
 *   40086  Frequency scale   (int16, 10^n)
 *   40093  DC Power          (uint16, scale @ 40094)
 *   40094  DC Power scale    (int16, 10^n)
 *   40095  Cabinet temp      (int16, scale @ 40106)
 *   40100  Total energy (Wh) (uint32, scale @ 40102) ← lifetime production
 *   40102  Energy scale      (int16, 10^n)
 *   40107  Inverter status   (uint16, see SE_STATUS below)
 */

import ModbusRTU from 'modbus-serial';
import modbusApi from '../modules/alphaess-modbus-tcp/services/api.js';
import settingsService from '../core/system/services/settingsService.js';

// ─── SolarEdge Connection Config ───────────────────────────────────────────
const SE_HOST    = '192.168.3.70';
const SE_PORT    = 1502;
const SE_UNIT_ID = 1;

// ─── Register Address Constants ────────────────────────────────────────────
const REG = {
  // ── Real-time ─────────────────────────────────────────────────
  BATTERY_POWER:      294,   // 0x0126  signed 16-bit, 1 W/bit, + = discharge
  BATTERY_SOC:        258,   // 0x0102  unsigned, 0.1 %/bit
  BATTERY_VOLTAGE:    256,   // 0x0100  unsigned, 0.1 V/bit
  BATTERY_CURRENT:    257,   // 0x0101  signed,   0.1 A/bit
  BATTERY_STATUS:     259,   // 0x0103  unsigned — Note1 (charge/discharge state)
  BATTERY_SOH:        283,   // 0x011B  unsigned, 0.1 %/bit
  BATTERY_CAPACITY:   281,   // 0x0119  unsigned, 0.1 kWh/bit
  BATTERY_NUM_PACKS:  280,   // 0x0118  unsigned (number of battery modules)
  BATTERY_REMAINING:  295,   // 0x0127  unsigned, 1 min/bit (remaining time)
  BATTERY_TYPE:       282,   // 0x011A  unsigned — Note3 (battery model ID)
  MIN_CELL_TEMP:      269,   // 0x010D  signed,   0.1 °C/bit
  MAX_CELL_TEMP:      272,   // 0x0110  signed,   0.1 °C/bit
  MIN_CELL_VOLT:      263,   // 0x0107  unsigned, 0.001 V/bit
  MAX_CELL_VOLT:      266,   // 0x010A  unsigned, 0.001 V/bit
  BATTERY_CHG_TOTAL:  288,   // 0x0120  unsigned 32-bit, 0.1 kWh (cumulative)
  BATTERY_DIS_TOTAL:  290,   // 0x0122  unsigned 32-bit, 0.1 kWh (cumulative)

  GRID_POWER_HI:      33,    // 0x0021  signed 32-bit (2 regs), 1 W/bit, + = export
  GRID_VOLT_L1:       20,    // 0x0014  unsigned, 1 V/bit
  GRID_VOLT_L2:       21,    // 0x0015  unsigned, 1 V/bit
  GRID_VOLT_L3:       22,    // 0x0016  unsigned, 1 V/bit
  GRID_CURR_L1:       23,    // 0x0017  signed,   0.1 A/bit
  GRID_CURR_L2:       24,    // 0x0018  signed,   0.1 A/bit
  GRID_CURR_L3:       25,    // 0x0019  signed,   0.1 A/bit
  GRID_FREQUENCY:     26,    // 0x001A  unsigned, 0.01 Hz/bit
  GRID_EXPORT_TOTAL:  16,    // 0x0010  unsigned 32-bit, 0.01 kWh (cumulative)
  GRID_IMPORT_TOTAL:  18,    // 0x0012  unsigned 32-bit, 0.01 kWh (cumulative)

  PV_POWER_HI:        1055,  // 0x041F  unsigned 32-bit, 1 W/bit
  PV1_VOLTAGE:        1053,  // 0x041D  unsigned, 0.1 V/bit
  PV1_CURRENT:        1054,  // 0x041E  unsigned, 0.1 A/bit
  PV2_VOLTAGE:        1057,  // 0x0421  unsigned, 0.1 V/bit
  PV2_CURRENT:        1058,  // 0x0422  unsigned, 0.1 A/bit
  INV_TEMP:           1077,  // 0x0435  unsigned, 0.1 °C/bit
  INV_WORK_MODE:      1088,  // 0x0440  unsigned — Note5
  INV_FREQ:           1052,  // 0x041C  unsigned, 0.01 Hz/bit
  INV_PV_TOTAL:       1086,  // 0x043E  unsigned 32-bit, 0.1 kWh (cumulative)
  INV_BACKUP_PWR_HI:  1050,  // 0x041A  unsigned 32-bit, 1 W/bit (UPS/Backup output)
  INV_BACKUP_V_L1:    1038,  // 0x040E  unsigned, 0.1 V/bit
  INV_BACKUP_V_L2:    1039,  // 0x040F  unsigned, 0.1 V/bit
  INV_BACKUP_V_L3:    1040,  // 0x0410  unsigned, 0.1 V/bit

  // ── System / Config ───────────────────────────────────────────
  FEED_IN_LIMIT:      1792,  // 0x0700  unsigned, 1 %/bit  (zero export limit)
  UPS_RESERVE_SOC:    2128,  // 0x0850  unsigned, 0.1 %/bit
  CHARGE_CUT_SOC:     2133,  // 0x0855  unsigned, 0.1 %/bit

  // ── Dispatch ──────────────────────────────────────────────────
  DISP_START:         2176,  // 0x0880  1=start, 0=stop
  DISP_PWR_HI:        2177,  // 0x0881  32-bit power, high word (offset 32000)
  DISP_RPW_HI:        2179,  // 0x0883  32-bit reactive power, high word
  DISP_MODE:          2181,  // 0x0885  dispatch mode (Note7)
  DISP_SOC:           2182,  // 0x0886  target SoC, 0.4 %/bit
  DISP_TIME_HI:       2183,  // 0x0887  duration in seconds, 32-bit high word

  // ── AC-Coupled PV candidates (wider search) ───────────────────
  // 0x041A = backup/EPS output power (unsigned 32-bit, 1 W/bit)
  // SolarEdge feeds into the EPS port → this may already be the answer.
  // Surrounding registers in the 0x0400–0x04FF inverter block are also scanned.
  INV_AC_COUPLED_CAND: 1050, // 0x041A  (same as INV_BACKUP_PWR_HI — re-check sign/type)

  // ── EMS Version ───────────────────────────────────────────────
  EMS_VER_HIGH:       1833,  // 0x0729
  EMS_VER_MID:        1834,  // 0x072A
  EMS_VER_LOW:        1835,  // 0x072B

  // ── Inverter Serial & Firmware (ASCII) ────────────────────────
  INV_MASTER_VER:     1600,  // 0x0640  5 × 2-byte chars (10 bytes)
  INV_SLAVE_VER:      1605,  // 0x0645  5 × 2-byte chars (10 bytes)
  INV_SN_START:       1610,  // 0x064A  10 × 2-byte chars (20 bytes = 20-char SN)
};

// ─── Label Tables ──────────────────────────────────────────────────────────

// Note5 inverter work mode labels
const INV_WORK_MODES = {
  0: 'Wait', 1: 'Online', 2: 'UPS / Backup', 3: 'Bypass',
  4: 'Fault', 5: 'DC Mode', 6: 'SelfTest', 7: 'Check',
  8: 'Update Master', 9: 'Update Slave', 10: 'Update ARM',
};

// Note3 battery type labels
const BATTERY_TYPES = {
  2: 'M4860', 3: 'M48100', 13: '48112-P', 16: 'Smile5-BAT',
  24: 'M4856-P', 27: 'Smile-BAT-10.3P', 30: 'Smile-BAT-10.1P',
  33: 'Smile-BAT-5.8P', 34: 'Smile-BAT5-JP', 35: 'Smile-BAT-13.7P',
};

// Note1 battery status
const BATTERY_STATUS_LABELS = {
  0: 'Idle', 1: 'Discharging', 256: 'Charging', 257: 'Charge+Discharge',
};

// ─── SolarEdge Register Constants ──────────────────────────────────────────
const SE_REG = {
  // Common Block
  SUNSPEC_ID:       40000,  // uint32  — "SunS" = 0x53756e53 (sanity check)
  MANUFACTURER:     40004,  // 16 regs ASCII
  MODEL:            40020,  // 16 regs ASCII
  SERIAL_NUMBER:    40044,  // 16 regs ASCII
  DEVICE_ADDRESS:   40068,  // uint16

  // Inverter Model Block (starts at 40069)
  MODEL_ID:         40069,  // uint16  101=1ph, 102=split, 103=3ph
  AC_CURRENT:       40071,  // uint16  total AC current (A, scaled)
  AC_CURRENT_L1:    40072,  // uint16  L1 current (A, scaled)
  AC_CURRENT_SF:    40075,  // int16   scale factor (10^n)
  AC_VOLTAGE_L1N:   40076,  // uint16  L1-N voltage (V, scaled)
  AC_VOLTAGE_SF:    40082,  // int16   scale factor
  AC_POWER:         40083,  // int16   AC power (W, scaled)     ← key value
  AC_POWER_SF:      40084,  // int16   scale factor
  AC_FREQUENCY:     40085,  // uint16  frequency (Hz, scaled)
  AC_FREQUENCY_SF:  40086,  // int16   scale factor
  AC_ENERGY_WH:     40093,  // uint32  lifetime energy (Wh, scaled)
  AC_ENERGY_SF:     40095,  // int16   scale factor
  DC_CURRENT:       40096,  // uint16  DC input current (A, scaled)
  DC_CURRENT_SF:    40097,  // int16   scale factor
  DC_VOLTAGE:       40098,  // uint16  DC input voltage (V, scaled)
  DC_VOLTAGE_SF:    40099,  // int16   scale factor
  DC_POWER:         40100,  // int16   DC input power (W, scaled)
  DC_POWER_SF:      40101,  // int16   scale factor
  CABINET_TEMP:     40103,  // int16   cabinet temperature (°C, scaled)
  TEMP_SF:          40106,  // int16   scale factor
  STATUS:           40107,  // uint16  inverter operating status
  STATUS_VENDOR:    40108,  // uint16  vendor-specific status
};

// SolarEdge inverter status codes
const SE_STATUS = {
  1: 'Off',
  2: 'Sleeping (auto-shutdown)',
  3: 'Grid Monitoring',
  4: 'Producing ⚡',
  5: 'Production throttled',
  6: 'Shutting down',
  7: 'Fault',
  8: 'Maintenance',
};

// SolarEdge model IDs
const SE_MODEL_TYPES = {
  101: 'Single Phase',
  102: 'Split Phase',
  103: 'Three Phase',
};

// ─── SolarEdge Client ───────────────────────────────────────────────────────
const seClient = new ModbusRTU();

const seReadUint16 = async (addr) => {
  const res = await seClient.readHoldingRegisters(addr, 1);
  return res.data[0] ?? 0;
};

const seReadInt16 = async (addr) => {
  const v = await seReadUint16(addr);
  return v > 32767 ? v - 65536 : v;
};

const seReadUint32 = async (addr) => {
  const res = await seClient.readHoldingRegisters(addr, 2);
  return ((res.data[0] << 16) | res.data[1]) >>> 0;
};

const seReadAscii = async (addr, numRegs) => {
  const res = await seClient.readHoldingRegisters(addr, numRegs);
  let str = '';
  for (const word of res.data) {
    const hi = (word >> 8) & 0xFF;
    const lo =  word       & 0xFF;
    if (hi && hi !== 0xFF) str += String.fromCharCode(hi);
    if (lo && lo !== 0xFF) str += String.fromCharCode(lo);
  }
  return str.replace(/\0/g, '').trim() || '—';
};

/** Apply SunSpec scale factor: value * 10^sf */
const seScale = (value, sf) => {
  if (sf === 0xFFFF || sf === -32768) return value; // undefined scale
  return value * Math.pow(10, sf);
};

// ─── SolarEdge Print Block ──────────────────────────────────────────────────

async function printSolarEdgeValues() {
  console.log("\n" + "─".repeat(75));
  console.log("☀️   SOLAREDGE  →  192.168.3.70:1502");
  console.log("─".repeat(75));

  try {
    await seClient.connectTCP(SE_HOST, { port: SE_PORT });
    seClient.setID(SE_UNIT_ID);
    seClient.setTimeout(3000);
    console.log("  ✅ SolarEdge ModBus connected\n");
  } catch (err) {
    console.log(`  ❌ SolarEdge connection failed: ${err.message}`);
    console.log("     → Check IP 192.168.3.70, port 1502, and that ModBus TCP is enabled");
    console.log("     → On SE inverters: SetApp → Communication → ModBus TCP → Enable");
    return;
  }

  try {
    // ── Common block ─────────────────────────────────────────────
    const manufacturer = await seReadAscii(SE_REG.MANUFACTURER, 16);
    const model        = await seReadAscii(SE_REG.MODEL, 16);
    const serialNumber = await seReadAscii(SE_REG.SERIAL_NUMBER, 16);
    const modelId      = await seReadUint16(SE_REG.MODEL_ID);
    const status       = await seReadUint16(SE_REG.STATUS);
    const statusVendor = await seReadUint16(SE_REG.STATUS_VENDOR);

    // ── Scale factors ────────────────────────────────────────────
    const currSF  = await seReadInt16(SE_REG.AC_CURRENT_SF);
    const voltSF  = await seReadInt16(SE_REG.AC_VOLTAGE_SF);
    const powSF   = await seReadInt16(SE_REG.AC_POWER_SF);
    const freqSF  = await seReadInt16(SE_REG.AC_FREQUENCY_SF);
    const energySF= await seReadInt16(SE_REG.AC_ENERGY_SF);
    const dcISF   = await seReadInt16(SE_REG.DC_CURRENT_SF);
    const dcVSF   = await seReadInt16(SE_REG.DC_VOLTAGE_SF);
    const dcPSF   = await seReadInt16(SE_REG.DC_POWER_SF);
    const tempSF  = await seReadInt16(SE_REG.TEMP_SF);

    // ── AC values ────────────────────────────────────────────────
    const acCurrentRaw = await seReadUint16(SE_REG.AC_CURRENT);
    const acCurrL1Raw  = await seReadUint16(SE_REG.AC_CURRENT_L1);
    const acVoltL1Raw  = await seReadUint16(SE_REG.AC_VOLTAGE_L1N);
    const acPowerRaw   = await seReadInt16(SE_REG.AC_POWER);
    const acFreqRaw    = await seReadUint16(SE_REG.AC_FREQUENCY);
    const acEnergyRaw  = await seReadUint32(SE_REG.AC_ENERGY_WH);

    // ── DC values ────────────────────────────────────────────────
    const dcCurrentRaw = await seReadUint16(SE_REG.DC_CURRENT);
    const dcVoltageRaw = await seReadUint16(SE_REG.DC_VOLTAGE);
    const dcPowerRaw   = await seReadInt16(SE_REG.DC_POWER);
    const cabinetTmpRw = await seReadInt16(SE_REG.CABINET_TEMP);

    // ── Apply scale factors ──────────────────────────────────────
    const acCurrent  = seScale(acCurrentRaw, currSF);
    const acCurrL1   = seScale(acCurrL1Raw,  currSF);
    const acVoltL1   = seScale(acVoltL1Raw,  voltSF);
    const acPower    = seScale(acPowerRaw,   powSF);
    const acFreq     = seScale(acFreqRaw,    freqSF);
    const acEnergyWh = seScale(acEnergyRaw,  energySF);
    const dcCurrent  = seScale(dcCurrentRaw, dcISF);
    const dcVoltage  = seScale(dcVoltageRaw, dcVSF);
    const dcPower    = seScale(dcPowerRaw,   dcPSF);
    const cabinetTmp = seScale(cabinetTmpRw, tempSF);

    const col = (label, value, unit) =>
      console.log(`  ${label.padEnd(26)}: ${String(value).padStart(10)} ${unit}`);

    console.log("  ── Device Info ──────────────────────────────────────────────────");
    col('Manufacturer',       manufacturer,                        '');
    col('Model',              model,                               '');
    col('Serial Number',      serialNumber,                        '');
    col('Inverter Type',      SE_MODEL_TYPES[modelId] ?? `ID ${modelId}`, '');
    col('Status',             SE_STATUS[status] ?? `Unknown (${status})`, '');
    if (statusVendor) col('Status (vendor)', `0x${statusVendor.toString(16).toUpperCase()}`, '');

    console.log("\n  ── AC Output ────────────────────────────────────────────────────");
    col('solar_power (AC)',   acPower.toFixed(0),                  'W    ← compare to AlphaESS pv_power');
    col('AC Current (total)', acCurrent.toFixed(2),                'A');
    col('AC Current L1',      acCurrL1.toFixed(2),                 'A');
    col('AC Voltage L1-N',    acVoltL1.toFixed(1),                 'V');
    col('AC Frequency',       acFreq.toFixed(2),                   'Hz');
    col('Lifetime AC Energy', (acEnergyWh / 1000).toFixed(3),      'kWh  (cumulative)');

    console.log("\n  ── DC Input (panels → inverter) ─────────────────────────────────");
    col('DC Voltage',         dcVoltage.toFixed(1),                'V');
    col('DC Current',         dcCurrent.toFixed(2),                'A');
    col('DC Power',           dcPower.toFixed(0),                  'W    (pre-inverter)');
    col('Cabinet Temp',       cabinetTmp.toFixed(1),               '°C');

    // ── Key comparison line ──────────────────────────────────────
    console.log("\n  ── Comparison ───────────────────────────────────────────────────");
    console.log(`  SolarEdge AC Power  : ${acPower.toFixed(0).padStart(7)} W  (this device, authoritative)`);
    console.log(`  DC Power (pre-conv) : ${dcPower.toFixed(0).padStart(7)} W  (before inverter losses)`);
    const efficiency = dcPower > 0 ? ((acPower / dcPower) * 100).toFixed(1) : '—';
    console.log(`  Inverter efficiency : ${efficiency.padStart(7)} %`);
    console.log(`\n  ⬆ Compare 'solar_power (AC)' against AlphaESS pv_power above.`);
    console.log(`    If AlphaESS pv_power ≈ SolarEdge AC Power → AlphaESS derives it correctly.`);
    console.log(`    If AlphaESS pv_power = 0                  → SolarEdge ModBus module needed.`);

  } catch (err) {
    console.log(`\n  ❌ Error reading SolarEdge registers: ${err.message}`);
    console.log("     The device responded but register read failed.");
    console.log("     → Verify unit ID = 1 and ModBus TCP is fully enabled");
  } finally {
    try { seClient.close(); } catch (_) {}
    console.log("\n  🔌 SolarEdge connection closed.");
  }
}

// ─── Low-level Helpers ─────────────────────────────────────────────────────

const writeInt32BE = async (addr, val) => {
  const high = (val >> 16) & 0xFFFF;
  const low  = val & 0xFFFF;
  await modbusApi._safeCall(() => modbusApi.client.writeRegisters(addr, [high, low]));
};

const readUint16 = async (addr) => {
  const res = await modbusApi._safeCall(() => modbusApi.client.readHoldingRegisters(addr, 1));
  return res?.data[0] ?? 0;
};

const readInt16 = async (addr) => {
  const v = await readUint16(addr);
  return v > 32767 ? v - 65536 : v;
};

const readUint32 = async (addr) => {
  const res = await modbusApi._safeCall(() => modbusApi.client.readHoldingRegisters(addr, 2));
  if (!res?.data) return 0;
  return ((res.data[0] << 16) | res.data[1]) >>> 0;
};

const readInt32 = async (addr) => {
  const res = await modbusApi._safeCall(() => modbusApi.client.readHoldingRegisters(addr, 2));
  if (!res?.data) return 0;
  let val = (res.data[0] << 16) | res.data[1];
  if (val > 2147483647) val -= 4294967296;
  return val;
};

/** Read N consecutive 16-bit registers and decode as ASCII string (high byte, low byte per word) */
const readAsciiString = async (addr, numRegs) => {
  const res = await modbusApi._safeCall(() => modbusApi.client.readHoldingRegisters(addr, numRegs));
  if (!res?.data) return '—';
  let str = '';
  for (const word of res.data) {
    const hi = (word >> 8) & 0xFF;
    const lo =  word       & 0xFF;
    if (hi) str += String.fromCharCode(hi);
    if (lo) str += String.fromCharCode(lo);
  }
  return str.replace(/\0/g, '').trim() || '—';
};

// ─── System Info Block ─────────────────────────────────────────────────────

async function printSystemInfo() {
  console.log("\n" + "─".repeat(75));
  console.log("📋  SYSTEM INFORMATION");
  console.log("─".repeat(75));

  const invSN       = await readAsciiString(REG.INV_SN_START, 10);
  const invMasterFW = await readAsciiString(REG.INV_MASTER_VER, 5);
  const invSlaveFW  = await readAsciiString(REG.INV_SLAVE_VER, 5);

  const emsVerH = await readUint16(REG.EMS_VER_HIGH);
  const emsVerM = await readUint16(REG.EMS_VER_MID);
  const emsVerL = await readUint16(REG.EMS_VER_LOW);

  const batType     = await readUint16(REG.BATTERY_TYPE);
  const batCapRaw   = await readUint16(REG.BATTERY_CAPACITY);
  const batNumPacks = await readUint16(REG.BATTERY_NUM_PACKS);
  const batSOH      = await readUint16(REG.BATTERY_SOH);

  const feedInLimit   = await readUint16(REG.FEED_IN_LIMIT);
  const upsReserveRaw = await readUint16(REG.UPS_RESERVE_SOC);
  const chargeCutRaw  = await readUint16(REG.CHARGE_CUT_SOC);

  const invMode    = await readUint16(REG.INV_WORK_MODE);
  const invModeStr = INV_WORK_MODES[invMode] ?? `Unknown (${invMode})`;
  const isUPS      = invMode === 2;

  const backupVL1 = (await readUint16(REG.INV_BACKUP_V_L1)) * 0.1;
  const backupVL2 = (await readUint16(REG.INV_BACKUP_V_L2)) * 0.1;
  const backupVL3 = (await readUint16(REG.INV_BACKUP_V_L3)) * 0.1;
  const backupPwr = await readUint32(REG.INV_BACKUP_PWR_HI);

  const row = (label, value) =>
    console.log(`  ${label.padEnd(26)}: ${value}`);

  row('Inverter SN',        invSN);
  row('Inverter FW Master', invMasterFW);
  row('Inverter FW Slave',  invSlaveFW);
  row('EMS Firmware',       `${emsVerH}.${emsVerM}.${emsVerL}`);
  row('Battery Type',       BATTERY_TYPES[batType] ?? `ID ${batType}`);
  row('Battery Modules',    `${batNumPacks}`);
  row('Battery Capacity',   `${(batCapRaw * 0.1).toFixed(1)} kWh`);
  row('Battery SoH',        `${(batSOH * 0.1).toFixed(1)} %`);
  row('Feed-in Limit',      `${feedInLimit} %${feedInLimit === 0 ? '  ⚠️  Zero Export ACTIVE' : ''}`);
  row('UPS Reserve SoC',    `${(upsReserveRaw * 0.1).toFixed(1)} %`);
  row('Charge Cut SoC',     `${(chargeCutRaw * 0.1).toFixed(1)} %`);
  row('Inverter Mode',      `${invModeStr}${isUPS ? '  ⚡ UPS ACTIVE' : ''}`);

  if (isUPS) {
    row('Backup Output L1',   `${backupVL1.toFixed(1)} V`);
    row('Backup Output L2',   `${backupVL2.toFixed(1)} V`);
    row('Backup Output L3',   `${backupVL3.toFixed(1)} V`);
    row('Backup Load',        `${backupPwr} W`);
  }
}

// ─── Snapshot Values Block ─────────────────────────────────────────────────

async function printSnapshotValues() {
  console.log("\n" + "─".repeat(75));
  console.log("📊  CURRENT VALUES  →  energy_snapshots mapping");
  console.log("─".repeat(75));

  // Battery
  const batPwrRaw  = await readInt16(REG.BATTERY_POWER);
  const batSoCRaw  = await readUint16(REG.BATTERY_SOC);
  const batVoltRaw = await readUint16(REG.BATTERY_VOLTAGE);
  const batCurrRaw = await readInt16(REG.BATTERY_CURRENT);
  const batMinCTmp = await readInt16(REG.MIN_CELL_TEMP);
  const batMaxCTmp = await readInt16(REG.MAX_CELL_TEMP);
  const batStatus  = await readUint16(REG.BATTERY_STATUS);
  const batRemain  = await readUint16(REG.BATTERY_REMAINING);
  const batChgTot  = await readUint32(REG.BATTERY_CHG_TOTAL);
  const batDisTot  = await readUint32(REG.BATTERY_DIS_TOTAL);

  const batPower   = batPwrRaw;
  const batSoC     = batSoCRaw  * 0.1;
  const batVoltage = batVoltRaw * 0.1;
  const batCurrent = batCurrRaw * 0.1;
  const batTempAvg = ((batMinCTmp + batMaxCTmp) * 0.1 / 2).toFixed(1);

  // Grid
  const gridPwr    = await readInt32(REG.GRID_POWER_HI);
  const gridPwrDB  = gridPwr * -1;   // DB convention: import +, export −
  const gridVL1    = await readUint16(REG.GRID_VOLT_L1);
  const gridVL2    = await readUint16(REG.GRID_VOLT_L2);
  const gridVL3    = await readUint16(REG.GRID_VOLT_L3);
  const gridIL1    = (await readInt16(REG.GRID_CURR_L1)) * 0.1;
  const gridIL2    = (await readInt16(REG.GRID_CURR_L2)) * 0.1;
  const gridIL3    = (await readInt16(REG.GRID_CURR_L3)) * 0.1;
  const gridFreq   = (await readUint16(REG.GRID_FREQUENCY)) * 0.01;
  const gridExpTot = (await readUint32(REG.GRID_EXPORT_TOTAL)) * 0.01;
  const gridImpTot = (await readUint32(REG.GRID_IMPORT_TOTAL)) * 0.01;

  // Solar / Inverter
  const pvPower    = await readUint32(REG.PV_POWER_HI);
  const pv1Volt    = (await readUint16(REG.PV1_VOLTAGE)) * 0.1;
  const pv1Curr    = (await readUint16(REG.PV1_CURRENT)) * 0.1;
  const pv2Volt    = (await readUint16(REG.PV2_VOLTAGE)) * 0.1;
  const pv2Curr    = (await readUint16(REG.PV2_CURRENT)) * 0.1;
  const invTemp    = (await readUint16(REG.INV_TEMP)) * 0.1;
  const invFreq    = (await readUint16(REG.INV_FREQ)) * 0.01;
  const pvTotKWh   = (await readUint32(REG.INV_PV_TOTAL)) * 0.1;

  // Calculated
  const loadPower  = Math.max(0, pvPower + batPower + gridPwrDB);

  // Print helper
  const col = (label, value, unit, dbCol) =>
    console.log(
      `  ${label.padEnd(26)}: ${String(value).padStart(10)} ${unit.padEnd(5)}` +
      (dbCol ? `  → ${dbCol}` : '')
    );

  console.log("\n  ── Battery ──────────────────────────────────────────────────────");
  col('battery_power',       batPower,                         'W',    'battery_power');
  col('battery_soc',         batSoC.toFixed(1),                '%',    'battery_soc');
  col('battery_voltage',     batVoltage.toFixed(1),            'V',    'battery_voltage');
  col('battery_current',     batCurrent.toFixed(1),            'A',    'battery_current');
  col('battery_temp (avg)',  batTempAvg,                       '°C',   'battery_temp');
  col('Battery Status',      BATTERY_STATUS_LABELS[batStatus] ?? batStatus, '', '(info only)');
  col('Remaining Time',      batRemain,                        'min',  '(info only)');
  col('Lifetime Charged',    (batChgTot * 0.1).toFixed(1),     'kWh',  '(cumulative — no daily reg)');
  col('Lifetime Discharged', (batDisTot * 0.1).toFixed(1),     'kWh',  '(cumulative — no daily reg)');

  console.log("\n  ── Grid ─────────────────────────────────────────────────────────");
  col('grid_power (DB)',     gridPwrDB,                        'W',    'grid_power  (import+, export−)');
  col('grid_voltage_l1',    gridVL1,                           'V',    'grid_voltage_l1');
  col('grid_voltage_l2',    gridVL2,                           'V',    'grid_voltage_l2');
  col('grid_voltage_l3',    gridVL3,                           'V',    'grid_voltage_l3');
  col('grid_current_l1',    gridIL1.toFixed(1),                'A',    'grid_current_l1');
  col('grid_current_l2',    gridIL2.toFixed(1),                'A',    'grid_current_l2');
  col('grid_current_l3',    gridIL3.toFixed(1),                'A',    'grid_current_l3');
  col('grid_frequency',     gridFreq.toFixed(2),               'Hz',   'grid_frequency');
  col('Lifetime Exported',  gridExpTot.toFixed(2),             'kWh',  '(cumulative — no daily reg)');
  col('Lifetime Imported',  gridImpTot.toFixed(2),             'kWh',  '(cumulative — no daily reg)');

  console.log("\n  ── Solar / Inverter ─────────────────────────────────────────────");
  col('solar_power',        pvPower,                           'W',    'solar_power / pv_power');
  col('PV1 Voltage',        pv1Volt.toFixed(1),                'V',    '(info only)');
  col('PV1 Current',        pv1Curr.toFixed(1),                'A',    '(info only)');
  col('PV2 Voltage',        pv2Volt.toFixed(1),                'V',    '(info only)');
  col('PV2 Current',        pv2Curr.toFixed(1),                'A',    '(info only)');
  col('inverter_temp',      invTemp.toFixed(1),                '°C',   'inverter_temp');
  col('Inverter Frequency', invFreq.toFixed(2),                'Hz',   '(info only)');
  col('Lifetime PV Energy', pvTotKWh.toFixed(1),               'kWh',  '(cumulative — no daily reg)');

  console.log("\n  ── Calculated ───────────────────────────────────────────────────");
  col('load_power',         loadPower.toFixed(0),              'W',    'load_power');
  console.log(`  ${'  = PV'.padEnd(26)}: ${String(pvPower).padStart(10)} W`);
  console.log(`  ${'  + Battery (dis+)'.padEnd(26)}: ${String(batPower).padStart(10)} W`);
  console.log(`  ${'  + Grid (import+)'.padEnd(26)}: ${String(gridPwrDB).padStart(10)} W`);

  console.log("\n  ── Not available via ModBus TCP on G3-T10 ───────────────────────");
  console.log("  solar_energy_today         0.0  (no daily register — derive from cumulative delta)");
  console.log("  battery_charge_today       0.0  (no daily register — derive from cumulative delta)");
  console.log("  battery_discharge_today    0.0  (no daily register — derive from cumulative delta)");
  console.log("  grid_energy_import_today   0.0  (no daily register — derive from cumulative delta)");
  console.log("  grid_energy_export_today   0.0  (no daily register — derive from cumulative delta)");
}

// ─── Real-time Status (used in dispatch loop) ──────────────────────────────

const fetchRealtime = async () => {
  const batRes = await modbusApi._safeCall(() =>
    modbusApi.client.readHoldingRegisters(REG.BATTERY_POWER, 1)
  );
  const battery = batRes.data[0] > 32767 ? batRes.data[0] - 65536 : batRes.data[0];
  const grid    = await readInt32(REG.GRID_POWER_HI);
  const socRes  = await modbusApi._safeCall(() =>
    modbusApi.client.readHoldingRegisters(REG.BATTERY_SOC, 1)
  );
  const currRaw = await readUint16(REG.BATTERY_CURRENT);   // RAW — no sign conversion
  const voltRaw = await readUint16(REG.BATTERY_VOLTAGE);
  return { battery, grid, soc: socRes.data[0] * 0.1, currRaw, voltRaw };
};

const logStatus = (mb) => {
  const load = Math.max(0, mb.battery + mb.grid);
  const now  = new Date().toLocaleTimeString();
  const flow = mb.battery < -100 ? "🔌 CHG" : mb.battery > 100 ? "🔋 DIS" : "💤 IDL";
  process.stdout.write(
    `\r[${now}] ${flow} | BAT: ${mb.battery.toFixed(0).padStart(6)}W` +
    ` | I_raw: ${String(mb.currRaw).padStart(6)}` +
    ` | V: ${(mb.voltRaw * 0.1).toFixed(1).padStart(6)}V` +
    ` | SOC: ${mb.soc}% `
  );
};

// ─── AC-Coupled PV Register Scan (v2) ─────────────────────────────────────
//
// The 0x5300–0x53FF PCS/DCDC block does NOT exist on this G3-T10 firmware.
//
// Strategy: scan the confirmed-working inverter register blocks instead.
// The SolarEdge connects to the AlphaESS EPS/backup output port, so the
// reading likely lives in the 0x0400–0x04FF inverter block alongside the
// registers we already read (battery power, grid power, load power, etc.).
//
// Three passes:
//   Pass 1 — Raw scan 0x0400–0x04FF  (inverter/AC block, confirmed working)
//   Pass 2 — Raw scan 0x0000–0x00FF  (EMS/battery block, confirmed working)
//   Pass 3 — Raw scan 0x0700–0x077F  (system config block)
//   Pass 4 — Targeted named reads of every register pair 0x041A–0x049C

async function printACCoupledPVScan() {
  console.log("\n" + "─".repeat(75));
  console.log("🔍  AC-COUPLED PV SCAN  →  inverter block (0x0400–0x04FF)");
  console.log("─".repeat(75));

  const safeRead = async (addr, len) => {
    try {
      const res = await modbusApi._safeCall(() =>
        modbusApi.client.readHoldingRegisters(addr, len)
      );
      return res?.data ?? null;
    } catch (_) { return null; }
  };

  const to32s = (hi, lo) => {
    let v = ((hi & 0xFFFF) << 16) | (lo & 0xFFFF);
    if (v > 0x7FFFFFFF) v -= 0x100000000;
    return v;
  };
  const to32u = (hi, lo) => (((hi & 0xFFFF) << 16) | (lo & 0xFFFF)) >>> 0;
  const hex4  = n => '0x' + (n & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');

  // ── Reference values for cross-checking ──────────────────────────────────
  const batPower  = await readInt16(REG.BATTERY_POWER);
  const gridPower = (await readInt32(REG.GRID_POWER_HI)) * -1;
  const pvRaw     = await readUint32(REG.PV_POWER_HI);
  console.log(`\n  Reference values at time of scan (for cross-checking):`);
  console.log(`    battery_power  = ${batPower} W  (positive = discharge)`);
  console.log(`    grid_power     = ${gridPower} W  (import+, export−)`);
  console.log(`    pv_power 041F  = ${pvRaw} W  (always 0 — MPPT inputs empty)`);
  console.log(`    SolarEdge AC   ≈ 240 W  (from SolarEdge block above)`);
  console.log(`\n  Registers flagged ⚡ where |value| is between 100 and 2000\n`);

  // ── Raw block scanner ─────────────────────────────────────────────────────
  const scanBlock = async (startAddr, endAddr, label) => {
    console.log(`  ── ${label} (${hex4(startAddr)}–${hex4(endAddr - 1)}) ──────────────────`);
    console.log(`  addr    raw(hex)  u16       s16       s32(+next)    u32(+next)`);
    console.log(`  ` + "─".repeat(70));

    const rawDump = [];
    for (let addr = startAddr; addr < endAddr; addr += 16) {
      const count = Math.min(16, endAddr - addr);
      const data  = await safeRead(addr, count);
      for (let i = 0; i < count; i++)
        rawDump.push({ addr: addr + i, val: data ? data[i] : null });
    }

    let printed = 0;
    for (let i = 0; i < rawDump.length; i++) {
      const { addr, val } = rawDump[i];
      if (val === null || val === 0 || val === 0xFFFF) continue;

      const u16 = val;
      const s16 = val > 0x7FFF ? val - 0x10000 : val;
      const next = rawDump[i + 1]?.val;
      const s32 = (next !== null && next !== undefined) ? to32s(val, next) : null;
      const u32 = (next !== null && next !== undefined) ? to32u(val, next) : null;
      const s32str = s32 !== null ? String(s32).padStart(12) : '           —';
      const u32str = u32 !== null ? String(u32).padStart(12) : '           —';

      const flag =
        (Math.abs(s16) >= 100 && Math.abs(s16) <= 2000) ||
        (s32 !== null && Math.abs(s32) >= 100 && Math.abs(s32) <= 2000)
          ? '  ← ⚡' : '';

      console.log(
        `  ${hex4(addr)}  ${hex4(val).padEnd(8)}  ${String(u16).padStart(6)}  ` +
        `${String(s16).padStart(8)}  ${s32str}  ${u32str}${flag}`
      );
      printed++;
    }
    if (printed === 0) console.log(`  (no non-zero registers in this block)`);
    console.log();
  };

  await scanBlock(0x0400, 0x0500, 'Inverter/AC block');
  await scanBlock(0x0000, 0x0100, 'EMS/battery block');
  await scanBlock(0x0700, 0x0780, 'System config block');

  // ── Targeted named reads 0x041A–0x049C ───────────────────────────────────
  console.log(`  ── Targeted reads: 0x041A–0x049C neighbourhood ─────────────────────`);
  const targets = [
    { addr: 0x0418, len: 2, label: '0x0418                (s32)', signed: true,  scale: 1    },
    { addr: 0x041A, len: 2, label: '0x041A INV_BACKUP_PWR (u32)', signed: false, scale: 1    },
    { addr: 0x041A, len: 2, label: '0x041A INV_BACKUP_PWR (s32)', signed: true,  scale: 1    },
    { addr: 0x041B, len: 2, label: '0x041B battery_power  (s32)', signed: true,  scale: 1    },
    { addr: 0x041D, len: 1, label: '0x041D PV1_VOLTAGE    (u16)', signed: false, scale: 0.1  },
    { addr: 0x041E, len: 1, label: '0x041E PV1_CURRENT    (u16)', signed: false, scale: 0.1  },
    { addr: 0x041F, len: 2, label: '0x041F PV_POWER       (u32)', signed: false, scale: 1    },
    { addr: 0x041F, len: 2, label: '0x041F PV_POWER       (s32)', signed: true,  scale: 1    },
    { addr: 0x0421, len: 1, label: '0x0421 PV2_VOLTAGE    (u16)', signed: false, scale: 0.1  },
    { addr: 0x0422, len: 1, label: '0x0422 PV2_CURRENT    (u16)', signed: false, scale: 0.1  },
    { addr: 0x0423, len: 2, label: '0x0423                (u32)', signed: false, scale: 1    },
    { addr: 0x0423, len: 2, label: '0x0423                (s32)', signed: true,  scale: 1    },
    { addr: 0x0480, len: 2, label: '0x0480                (s32)', signed: true,  scale: 1    },
    { addr: 0x0482, len: 2, label: '0x0482                (s32)', signed: true,  scale: 1    },
    { addr: 0x0484, len: 2, label: '0x0484 grid_power     (s32)', signed: true,  scale: 1    },
    { addr: 0x0486, len: 2, label: '0x0486                (s32)', signed: true,  scale: 1    },
    { addr: 0x0488, len: 2, label: '0x0488 PV_energy_today(u32)', signed: false, scale: 0.01 },
    { addr: 0x048A, len: 2, label: '0x048A AC_PV_power    (s32)', signed: true,  scale: 1    },
    { addr: 0x048A, len: 2, label: '0x048A AC_PV_power    (u32)', signed: false, scale: 1    },
    { addr: 0x048C, len: 2, label: '0x048C                (s32)', signed: true,  scale: 1    },
    { addr: 0x048E, len: 2, label: '0x048E                (s32)', signed: true,  scale: 1    },
    { addr: 0x0490, len: 2, label: '0x0490                (s32)', signed: true,  scale: 1    },
    { addr: 0x0492, len: 2, label: '0x0492 load_power     (s32)', signed: true,  scale: 1    },
    { addr: 0x0494, len: 2, label: '0x0494                (s32)', signed: true,  scale: 1    },
    { addr: 0x0496, len: 2, label: '0x0496                (s32)', signed: true,  scale: 1    },
    { addr: 0x0498, len: 2, label: '0x0498                (s32)', signed: true,  scale: 1    },
    { addr: 0x049A, len: 2, label: '0x049A                (s32)', signed: true,  scale: 1    },
    { addr: 0x049C, len: 1, label: '0x049C grid_frequency (u16)', signed: false, scale: 0.01 },
  ];

  const KNOWN = new Set([0x041B, 0x0484, 0x0492]); // battery, grid, load
  console.log(`  ${'register'.padEnd(40)} ${'value'.padStart(12)}`);
  console.log(`  ` + "─".repeat(60));

  for (const r of targets) {
    const data = await safeRead(r.addr, r.len);
    if (!data) {
      console.log(`  ${r.label.padEnd(40)} ${'ERROR'.padStart(12)}`);
      continue;
    }
    let val;
    if (r.len === 1) {
      val = r.signed ? (data[0] > 0x7FFF ? data[0] - 0x10000 : data[0]) : data[0];
    } else {
      val = r.signed ? to32s(data[0], data[1]) : to32u(data[0], data[1]);
    }
    val = val * r.scale;

    const flag = !KNOWN.has(r.addr) && Math.abs(val) >= 100 && Math.abs(val) <= 2000
      ? '  ← ⚡ solar candidate?' : '';

    console.log(
      `  ${r.label.padEnd(40)} ` +
      `${String(val.toFixed ? val.toFixed(r.scale < 1 ? 2 : 0) : val).padStart(12)}${flag}`
    );
  }

  console.log(`\n  ── Conclusion ───────────────────────────────────────────────────`);
  console.log(`  Match any ⚡ value against SolarEdge AC power (~240 W).`);
  console.log(`  If no match: G3-T10 firmware does not expose AC-coupled PV power`);
  console.log(`  via Modbus TCP. Use the SolarEdge module as authoritative source.`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function runComparisonTest() {
  console.log("\n" + "=".repeat(75));
  console.log("🚀 WOLFFIE: SMILE G3-T10 + SOLAREDGE COMPARISON (v6.8)");
  console.log("=".repeat(75));

  try {
    const mbSettings = await settingsService.getModuleSettings('alphaess-modbus-tcp');
    await modbusApi.connect(mbSettings.host, mbSettings.port, mbSettings.unit_id);
    console.log("✅ AlphaESS ModBus Connected.");

    await printSystemInfo();
    await printSnapshotValues();
    await printSolarEdgeValues();
    await printACCoupledPVScan();

    console.log("\n" + "=".repeat(75));
    await new Promise(r => {
      process.stdout.write("\nPress ENTER to start dispatch test, or Ctrl+C to exit... ");
      process.stdin.once('data', r);
    });

    // ── Phase 1: Clear any active cloud/dispatch mode ────────────
    console.log("\n⚡ Phase 1: Interrupting Cloud Control...");
    await modbusApi._safeCall(() => modbusApi.client.writeRegister(REG.DISP_START, 0));
    await modbusApi._safeCall(() => modbusApi.client.writeRegister(REG.DISP_MODE, 5));
    await new Promise(r => setTimeout(r, 1000));
    console.log("   ✅ Interrupter signal sent.");

    // ── Phase 2: Dispatch loop — charge at 4000 W ────────────────
    const TARGET_WATTS   = -2000;
    const RAW_POWER      = Math.round(32000 + TARGET_WATTS); // 24000 = charge
    const TARGET_SOC_PCT = 100;
    const SOC_RAW        = Math.round(TARGET_SOC_PCT / 0.4); // 200
    const DURATION_SEC   = 600;
    const TEST_CYCLES    = 150;

    console.log(`\n💓 Phase 2: Starting Local Heartbeat (${TARGET_WATTS}W, target SoC ${TARGET_SOC_PCT}%)...`);
    console.log(`   rawPower=${RAW_POWER}  socRaw=${SOC_RAW}  duration=${DURATION_SEC}s\n`);

    let count = 0;
    while (count < TEST_CYCLES) {
      await writeInt32BE(REG.DISP_TIME_HI, DURATION_SEC);
      await writeInt32BE(REG.DISP_PWR_HI, RAW_POWER);
      await modbusApi._safeCall(() => modbusApi.client.writeRegister(REG.DISP_MODE, 2));
      await modbusApi._safeCall(() => modbusApi.client.writeRegister(REG.DISP_SOC, SOC_RAW));
      await modbusApi._safeCall(() => modbusApi.client.writeRegister(REG.DISP_START, 1));

      const mb = await fetchRealtime();
      logStatus(mb);

      if (mb.soc >= TARGET_SOC_PCT) {
        console.log(`\n   ✅ Target SoC ${TARGET_SOC_PCT}% reached (current: ${mb.soc}%) — stopping early.`);
        break;
      }

      await new Promise(r => setTimeout(r, 2000));
      count++;
    }

    // ── Phase 3: Return to normal ────────────────────────────────
    console.log("\n\n🛑 STOPPING: Returning to Auto...");
    await modbusApi._safeCall(() => modbusApi.client.writeRegister(REG.DISP_START, 0));
    await modbusApi._safeCall(() => modbusApi.client.writeRegister(REG.DISP_MODE, 5));
    console.log("✅ Returned to Normal mode.");

  } catch (e) {
    console.error("\n❌ Test Failed:", e.stack);
  } finally {
    process.stdin.destroy();
    process.exit(0);
  }
}

runComparisonTest();