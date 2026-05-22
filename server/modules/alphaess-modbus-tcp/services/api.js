// modules/alphaess-modbus-tcp/services/api.js
import ModbusRTU from 'modbus-serial';
import { createConnection } from 'net';
import db from '../../../config/database.js';

/**
 * AlphaESS SMILE G3-T10 ModBus TCP API
 *
 * All register addresses verified against official AlphaESS
 * ModBus RTU/TCP Protocol document (v1.28, 2021-09-06).
 *
 * Register map section references:
 *   Household Battery  : 0x0100 – 0x0148  (decimal 256 – 328)
 *   Household Inverter : 0x0400 – 0x0653  (decimal 1024 – 1619)
 *   System             : 0x0700 – 0x072B  (decimal 1792 – 1835)
 *   System Config      : 0x0800 – 0x0810  (decimal 2048 – 2064)
 *   Time Period Control: 0x084F – 0x0859  (decimal 2127 – 2137)
 *   Dispatch           : 0x0880 – 0x0888  (decimal 2176 – 2184)
 *
 * DAILY ENERGY COUNTERS:
 *   The AlphaESS protocol does NOT expose per-day energy counters via ModBus TCP.
 *   Registers 0x0120–0x0123 (battery) and 0x043E–0x043F (PV) and 0x0010–0x0013 (grid)
 *   are CUMULATIVE lifetime totals.
 *
 *   Daily values are derived by subtracting a midnight baseline that is stored in
 *   system_settings (category 'alphaess_modbus'). The baseline is written at 00:05
 *   by dataCollector.runDailyTasks(), and bootstrapped automatically on first run.
 *   fetchAll() handles baseline reads, bootstrap, and delta calculation transparently.
 */
class AlphaModbusAPI {
  constructor() {
    this.client = new ModbusRTU();
    this.isConnected = false;
    this.lastCallTime = 0;
    this.minDelay = 400; // Hardware safety delay (ms)
    this.queue = Promise.resolve();
    this._connMutex = Promise.resolve();
    this._config = null;

    // In-memory dispatch state.
    // Cleared on restart — resetOnStartup() ensures the inverter is reset too.
    this._dispatch = { active: false, mode: null, watts: 0, endTime: null, _timer: null };
  }

  // ─── Connection ────────────────────────────────────────────────────────────
  async safeClose() {
    try {
      await Promise.race([
        Promise.resolve(this.client.close()).catch(() => {}),
        new Promise(r => setTimeout(r, 1000)),
      ]);
    } catch (_) {}
    this.isConnected = false;
  }
  async checkStatus(host, port) {
    const parsedPort = parseInt(port);
    if (!host || isNaN(parsedPort)) {
      console.warn('     - checkStatus: invalid host/port, skipping probe');
      return false;
    }
    return new Promise((resolve) => {
      const socket = createConnection({ host, port: parsedPort, timeout: 2000 });
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('error',   () => { socket.destroy(); resolve(false); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
    });
  }

  setConfig(config) { this._config = config; }

  /**
   * Execute fn() inside a serialised TCP session.
   * closeAfter=false  keep connection open (collector cycles — avoids rapid reconnect ECONNRESET)
   * closeAfter=true   close after fn() (control writes: dispatch, reset, timer auto-stop)
   *
   * TCP connect is wrapped in Promise.race with a 3-second timeout.
   * modbus-serial's connectTCP has no built-in connect timeout — without this,
   * a filtered/unresponsive host hangs the promise indefinitely, producing
   * zero output and preventing the collection cycle from ever completing.
   */
  async withConnection(fn, closeAfter = false) {
    const slot = this._connMutex.then(async () => {
      this.queue = Promise.resolve();
      await this.safeClose();
      this.isConnected = false;

      await Promise.race([
        this.client.connectTCP(this._config.host, { port: parseInt(this._config.port) }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TCP connect timeout (3s)')), 3000)),
      ]);
      await this.client.setID(parseInt(this._config.unit_id));
      this.client.setTimeout(2000);
      this.isConnected = true;

      try {
        return await fn();
      } finally {
        if (closeAfter) {
          await this.safeClose();
        }
      }
    });
    this._connMutex = slot.catch(() => {});
    return slot;
  }

  async connect(host, port, unitId = 85) {
    await this.safeClose();
    this.isConnected = false;
    await Promise.race([
      this.client.connectTCP(host, { port: parseInt(port) }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TCP connect timeout (3s)')), 3000)),
    ]);
    await this.client.setID(parseInt(unitId));
    this.client.setTimeout(2000);
    this.isConnected = true;
  }

  // ─── Queue / Safety ────────────────────────────────────────────────────────

  /**
   * Serialises all Modbus register reads/writes behind a single promise chain
   * so that hardware timing (minDelay) is respected even under concurrent calls.
   *
   * Fix (v6.8): this.queue must NEVER hold a rejected promise. A rejected queue
   * causes every subsequent _safeCall to chain a .then() onto a rejection with
   * no .catch(), producing an unhandled rejection that crashes the Node process.
   *
   * The trick: we store a "safe" version of the next slot in this.queue (one
   * that swallows the error via .catch(() => {})), and separately return a
   * "live" promise to the caller that DOES reject on error. The queue stays
   * clean; the caller still receives the thrown error.
   */
  async _safeCall(operation) {
    // Build the next slot: runs after the current queue resolves, performs the
    // operation, and propagates the result (or error) to whoever awaits it.
    const next = this.queue.then(async () => {
      const now = Date.now();
      const elapsed = now - this.lastCallTime;
      if (elapsed < this.minDelay) await new Promise(r => setTimeout(r, this.minDelay - elapsed));
      this.lastCallTime = Date.now();
      return operation(); // may resolve or reject
    });

    // this.queue advances to the settled (non-throwing) version of next so that
    // a future _safeCall always chains onto a resolved promise, never a rejected one.
    this.queue = next.catch(() => {});

    // Return the live promise so the caller receives the real result or error.
    return next;
  }

  // ─── Low-level Reads ───────────────────────────────────────────────────────

  /**
   * Big-Endian signed 32-bit integer read (2 consecutive registers).
   * Per AlphaESS protocol: high word first, low word second.
   */
  async _readInt32(addr) {
    const res = await this._safeCall(() => this.client.readHoldingRegisters(addr, 2));
    let val = (res.data[0] << 16) | res.data[1];
    if (val > 2147483647) val -= 4294967296;
    return val;
  }

  /**
   * Big-Endian unsigned 32-bit integer read (2 consecutive registers).
   */
  async _readUint32(addr) {
    const res = await this._safeCall(() => this.client.readHoldingRegisters(addr, 2));
    return ((res.data[0] << 16) | res.data[1]) >>> 0;
  }

  /** Single signed 16-bit read (2's complement) */
  async _readInt16(addr) {
    const res = await this._safeCall(() => this.client.readHoldingRegisters(addr, 1));
    const val = res.data[0];
    return val > 32767 ? val - 65536 : val;
  }

  /** Single unsigned 16-bit read */
  async _readUint16(addr) {
    const res = await this._safeCall(() => this.client.readHoldingRegisters(addr, 1));
    return res.data[0];
  }

  /** Write a single holding register (function code 0x06) */
  async _writeReg(addr, value) {
    await this._safeCall(() => this.client.writeRegister(addr, value));
  }

  // ─── Daily Baseline ────────────────────────────────────────────────────────

  /**
   * Read the midnight baseline from system_settings.
   * Returns null if no baseline exists for today (first run ever, or new day
   * before the 00:05 task has run — handled gracefully in fetchAll).
   *
   * Stored keys (category = 'alphaess_modbus'):
   *   daily_baseline_date       YYYY-MM-DD
   *   daily_baseline_bat_chg    kWh (float string)
   *   daily_baseline_bat_dis    kWh (float string)
   *   daily_baseline_grid_exp   kWh (float string)
   *   daily_baseline_grid_imp   kWh (float string)
   *   daily_baseline_pv_total   kWh (float string)
   */
  async _readDailyBaseline() {
    try {
      const [rows] = await db.pool.query(
        `SELECT setting_key, setting_value
           FROM system_settings
          WHERE category = 'alphaess_modbus'
            AND setting_key IN (
              'daily_baseline_date',
              'daily_baseline_bat_chg',
              'daily_baseline_bat_dis',
              'daily_baseline_grid_exp',
              'daily_baseline_grid_imp',
              'daily_baseline_pv_total'
            )`
      );
      if (!rows.length) return null;

      const m = Object.fromEntries(rows.map(r => [r.setting_key, r.setting_value]));
      const today = new Date().toISOString().slice(0, 10);
      if (m.daily_baseline_date !== today) return null; // stale — new day

      return {
        bat_chg:  parseFloat(m.daily_baseline_bat_chg  ?? 0),
        bat_dis:  parseFloat(m.daily_baseline_bat_dis  ?? 0),
        grid_exp: parseFloat(m.daily_baseline_grid_exp ?? 0),
        grid_imp: parseFloat(m.daily_baseline_grid_imp ?? 0),
        pv_total: parseFloat(m.daily_baseline_pv_total ?? 0),
      };
    } catch (err) {
      console.warn('[AlphaModbus] Could not read daily baseline:', err.message);
      return null;
    }
  }

  /**
   * Write (upsert) the midnight baseline into system_settings.
   * Called by dataCollector.runDailyTasks() at 00:05, and on first-ever run
   * when no baseline exists yet.
   *
   * @param {object} totals  { bat_chg, bat_dis, grid_exp, grid_imp, pv_total } — all in kWh
   */
  async writeDailyBaseline(totals) {
    const today = new Date().toISOString().slice(0, 10);
    const entries = [
      ['daily_baseline_date',    today,                          'string'],
      ['daily_baseline_bat_chg', totals.bat_chg.toFixed(4),     'number'],
      ['daily_baseline_bat_dis', totals.bat_dis.toFixed(4),     'number'],
      ['daily_baseline_grid_exp',totals.grid_exp.toFixed(4),    'number'],
      ['daily_baseline_grid_imp',totals.grid_imp.toFixed(4),    'number'],
      ['daily_baseline_pv_total',totals.pv_total.toFixed(4),    'number'],
    ];

    try {
      for (const [key, value, type] of entries) {
        await db.pool.query(
          `INSERT OR REPLACE INTO system_settings (category, setting_key, setting_value, value_type, description)
               VALUES ('alphaess_modbus', ?, ?, ?, ?)`,
          [key, value, type, `AlphaESS ModBus daily baseline — ${key}`]
        );
      }
      console.log(`[AlphaModbus] Daily baseline written for ${today}`);
    } catch (err) {
      console.error('[AlphaModbus] Failed to write daily baseline:', err.message);
    }
  }

  // ─── Data Collection ───────────────────────────────────────────────────────

  /**
   * Fetch all real-time data from the inverter.
   *
   * Daily energy values (charge_today, discharge_today, import_today,
   * export_today, energy_today) are derived by subtracting the midnight
   * cumulative baseline from current cumulative register values.
   * The baseline is stored in system_settings and written at 00:05 daily
   * by dataCollector.runDailyTasks().
   *
   * Register reference (all holding registers):
   *
   *   BATTERY
   *   0x0102 =  258  Battery SoC                  unsigned, 0.1 %/bit
   *   0x0126 =  294  Battery Power                signed 16-bit, 1 W/bit
   *                                               positive = discharge
   *   0x0120/0121 = 288  Battery charge energy    unsigned 32-bit, 0.1 kWh (CUMULATIVE)
   *   0x0122/0123 = 290  Battery discharge energy unsigned 32-bit, 0.1 kWh (CUMULATIVE)
   *
   *   GRID METER (Household Meter section)
   *   0x0014 =   20  Voltage of A phase (Grid)    unsigned, 1 V/bit
   *   0x0021/0022 = 33  Total Active power (Grid) signed 32-bit, 1 W/bit
   *                    positive = export to grid (invert in collector for DB)
   *   0x0010/0011 =  16  Grid export total         unsigned 32-bit, 0.01 kWh (CUMULATIVE)
   *   0x0012/0013 =  18  Grid import total         unsigned 32-bit, 0.01 kWh (CUMULATIVE)
   *
   *   INVERTER
   *   0x041F/0420 = 1055  PV1 power               unsigned 32-bit, 1 W/bit
   *   0x0435      = 1077  INV Temperature          unsigned, 0.1 °C/bit
   *   0x043E/043F = 1086  Inverter Total PV Energy unsigned 32-bit, 0.1 kWh (CUMULATIVE)
   */
  async fetchAll() {
    // Battery
    const socRaw      = await this._readUint16(258);   // 0x0102
    const batteryPwr  = await this._readInt16(294);    // 0x0126  +W = discharge
    const batChgRaw   = await this._readUint32(288);   // 0x0120-0121  cumulative
    const batDisRaw   = await this._readUint32(290);   // 0x0122-0123  cumulative

    // Grid
    const l1VoltRaw    = await this._readUint16(20);   // 0x0014  1 V/bit
    const gridPwr      = await this._readInt32(33);    // 0x0021-0022  +W = export
    const gridExpRaw   = await this._readUint32(16);   // 0x0010-0011  0.01 kWh cumulative
    const gridImpRaw   = await this._readUint32(18);   // 0x0012-0013  0.01 kWh cumulative

    // Inverter / PV
    const pvPwrRaw    = await this._readUint32(1055);  // 0x041F-0420  1 W/bit
    const tempRaw     = await this._readUint16(1077);  // 0x0435  0.1 °C/bit
    const pvEnergyRaw = await this._readUint32(1086);  // 0x043E-043F  0.1 kWh cumulative
    const invFreqRaw  = await this._readUint16(1052);  // 0x041C  0.01 Hz/bit

    // Current cumulative totals in kWh
    const totals = {
      bat_chg:  batChgRaw  * 0.1,   // kWh
      bat_dis:  batDisRaw  * 0.1,   // kWh
      grid_exp: gridExpRaw * 0.01,  // kWh
      grid_imp: gridImpRaw * 0.01,  // kWh
      pv_total: pvEnergyRaw * 0.1,  // kWh
    };

    // Load (or bootstrap) the midnight baseline
    let baseline = await this._readDailyBaseline();
    if (!baseline) {
      // First ever run, or day rolled over before 00:05 task ran —
      // write current values as today's baseline so counters start at 0.
      await this.writeDailyBaseline(totals);
      baseline = { ...totals };
    }

    // Daily deltas — clamp to 0 to avoid negative values on restart edge cases
    const clamp = (v) => Math.max(0, Math.round(v * 100) / 100);

    const batChgToday  = clamp(totals.bat_chg  - baseline.bat_chg);
    const batDisToday  = clamp(totals.bat_dis  - baseline.bat_dis);
    const gridExpToday = clamp(totals.grid_exp - baseline.grid_exp);
    const gridImpToday = clamp(totals.grid_imp - baseline.grid_imp);
    const pvToday      = clamp(totals.pv_total - baseline.pv_total);

    // Home energy today = solar produced + grid imported + battery discharged
    //                   - grid exported - battery charged
    const homeToday = clamp(
      pvToday + gridImpToday + batDisToday - gridExpToday - batChgToday
    );

    return {
      battery: {
        power:           batteryPwr,           // W, positive = discharge
        soc:             socRaw * 0.1,         // %
        charge_total:    totals.bat_chg,       // kWh cumulative lifetime
        discharge_total: totals.bat_dis,       // kWh cumulative lifetime
        charge_today:    batChgToday,          // kWh since midnight
        discharge_today: batDisToday,          // kWh since midnight
      },
      grid: {
        total_active_power: gridPwr,           // W, positive = export
        l1_voltage:         l1VoltRaw,         // V
        import_today:       gridImpToday,      // kWh since midnight
        export_today:       gridExpToday,      // kWh since midnight
      },
      solar: {
        total_power:  pvPwrRaw,                // W
        energy_total: totals.pv_total,         // kWh cumulative lifetime
        energy_today: pvToday,                 // kWh since midnight
      },
      home: {
        energy_today: homeToday,               // kWh since midnight (derived)
      },
      system: {
        inverter_temp: tempRaw * 0.1,          // °C
        inv_freq:      invFreqRaw * 0.01,      // Hz
      },
    };
  }

  // ─── Inverter Mode ─────────────────────────────────────────────────────────

  /**
   * Read the current inverter operating mode.
   * Register 0x0440 (decimal 1088), unsigned 16-bit.
   *
   * Returns { mode: string, gridConnected: bool }
   * gridConnected = true only when mode is 'Online' (value 1).
   * Any other mode (UPS/Backup, Fault, etc.) means grid is unavailable.
   *
   * Mode values per AlphaESS protocol Note5:
   *   0=Wait  1=Online  2=UPS/Backup  3=Bypass  4=Fault
   *   5=DC Mode  6=SelfTest  7=Check  8=Update Master
   *   9=Update Slave  10=Update ARM
   */
  async readInverterMode() {
    const INV_WORK_MODES = {
      0: 'Wait', 1: 'Online', 2: 'UPS / Backup', 3: 'Bypass',
      4: 'Fault', 5: 'DC Mode', 6: 'SelfTest', 7: 'Check',
      8: 'Update Master', 9: 'Update Slave', 10: 'Update ARM',
    };
    const raw  = await this._readUint16(1088); // 0x0440
    const mode = INV_WORK_MODES[raw] ?? `Unknown (${raw})`;
    return {
      mode,
      gridConnected: raw === 1, // Only 'Online' means grid is present
    };
  }

  // ─── Write / Control Methods ───────────────────────────────────────────────

  /**
   * UPS / Backup Reserve SoC
   * Register 0x0850 = 2128: UPS Reserve Soc, unsigned, 0.1 %/bit
   */
  async writeUPS(percent) {
    const clamped = Math.min(100, Math.max(0, Math.round(percent)));
    await this._writeReg(2128, clamped * 10); // 0x0850
  }

  /**
   * Charge Cut SoC (the SoC at which charging stops — analogous to min SoC / DoD)
   * Register 0x0855 = 2133, unsigned, 0.1 %/bit
   */
  async writeMinSoC(percent) {
    const clamped = Math.min(100, Math.max(0, Math.round(percent)));
    await this._writeReg(2133, clamped * 10); // 0x0855
  }

  /** Alias — DoD maps to the same Charge Cut SoC register */
  async writeDoD(percent) {
    return this.writeMinSoC(percent);
  }

  /**
   * Feed-into-grid / Zero Export limit
   * Register 0x0700 = 1792: Feed into grid percent, unsigned, 1 %/bit
   * 0 = zero export, 100 = unrestricted
   */
  async writeLimit(percent) {
    const clamped = Math.min(100, Math.max(0, Math.round(percent)));
    await this._writeReg(1792, clamped); // 0x0700
  }

  /**
   * Low-level dispatch: Charge or Discharge command.
   * Used directly by startCharge() / startDischarge(). Can also be called
   * from the legacy /dispatch route for raw control without a timer.
   *
   * Dispatch register map (0x0880–0x0888):
   *   0x0880 = 2176  Dispatch Start         1=start, 0=stop
   *   0x0881/0882 = 2177  Dispatch Active power  signed 32-bit, 1 W, offset 32000
   *                       charge < 32000, discharge > 32000
   *   0x0885 = 2181  Dispatch Mode          Note7 (2 = SoC control used here)
   *   0x0886 = 2182  Dispatch SOC           unsigned, 0.4 %/bit
   *
   * Note7 mode values from spec:
   *   1=Charge from PV only, 2=SoC control, 3=Load following,
   *   4=Maximise output, 5=Normal, 6=Optimise consumption, 7=Maximise consumption
   */
  async setDispatch(mode, watts, targetSoc) {
    const power = mode === 'charge'
      ? Math.max(0,     32000 - Math.round(watts))   // charge: < 32000
      : Math.min(65000, 32000 + Math.round(watts));  // discharge: > 32000

    const socVal = Math.round(Math.min(100, Math.max(0, targetSoc)) / 0.4);

    const highWord = (power >> 16) & 0xFFFF;
    const lowWord  = power & 0xFFFF;

    await this._writeReg(2177, highWord); // 0x0881 power high word
    await this._writeReg(2178, lowWord);  // 0x0882 power low word
    await this._writeReg(2181, 2);        // 0x0885 SoC control mode
    await this._writeReg(2182, socVal);   // 0x0886 target SoC
    await this._writeReg(2176, 1);        // 0x0880 start dispatch
  }

  /**
   * Reset to automatic / normal mode.
   * Stops dispatch and sets mode to 5 (Normal Mode per Note7).
   */
  async resetToAuto() {
    await this._writeReg(2176, 0); // 0x0880 stop dispatch
    await this._writeReg(2181, 5); // 0x0885 Normal Mode
  }

  // ─── Timed Dispatch ────────────────────────────────────────────────────────

  /**
   * Start a timed charge-from-grid session.
   * Sends the Modbus dispatch command, then arms a timer to call resetToAuto()
   * when durationHours elapses.
   *
   * @param {number} watts         Charge power in W
   * @param {number} targetSoc     Stop charging at this SoC (%)
   * @param {number} durationHours Auto-stop after this many hours
   */
  async startCharge(watts, targetSoc, durationHours) {
    await this.withConnection(() => this.setDispatch('charge', watts, targetSoc), true);
    this._armTimer('charge', watts, durationHours);
  }

  /**
   * Start a timed discharge-to-grid session.
   *
   * @param {number} watts         Discharge power in W
   * @param {number} minimumSoc    Stop discharging when SoC hits this floor (%)
   * @param {number} durationHours Auto-stop after this many hours
   */
  async startDischarge(watts, minimumSoc, durationHours) {
    await this.withConnection(() => this.setDispatch('discharge', watts, minimumSoc), true);
    this._armTimer('discharge', watts, durationHours);
  }

  /**
   * Cancel any active dispatch and return the inverter to Self-Consumption mode.
   */
  async stopDispatch() {
    this._clearTimer();
    await this.withConnection(() => this.resetToAuto(), true);
  }

  /**
   * Returns the current in-memory dispatch state for the UI status bar.
   * Pure in-memory read — no Modbus I/O.
   */
  getDispatchStatus() {
    const { active, mode, watts, endTime } = this._dispatch;
    const remainingSeconds = active && endTime
      ? Math.max(0, Math.round((endTime - Date.now()) / 1000))
      : 0;
    return {
      active,
      charging:         active && mode === 'charge',
      discharging:      active && mode === 'discharge',
      watts,
      remainingSeconds,
    };
  }

  /**
   * Called once during module init (after connect()) to ensure the inverter
   * is in a known state after a crash or restart that may have left a
   * dispatch command running in the hardware registers.
   * Safe to call when nothing is active — resetToAuto() is idempotent.
   */
  async resetOnStartup() {
    try {
      await this.withConnection(() => this.resetToAuto(), true);
      console.log('     - Startup reset: inverter returned to Self-Consumption mode.');
    } catch (e) {
      console.warn('     - Startup reset failed (inverter may be offline):', e.message);
    }
  }

  // ─── Internal Timer Helpers ────────────────────────────────────────────────

  /**
   * Arms the auto-stop timer and updates _dispatch state.
   * Always cancels any previous timer first so back-to-back commands
   * don't leave a stale timer running.
   */
  _armTimer(mode, watts, durationHours) {
    this._clearTimer();
    const ms = Math.round(durationHours * 3600 * 1000);
    const endTime = Date.now() + ms;

    const _timer = setTimeout(async () => {
      console.log(`[AlphaModbus] Dispatch timer expired (${mode} ${watts}W), resetting to auto.`);
      try {
        await this.withConnection(() => this.resetToAuto(), true);
      } catch (e) {
        console.error('[AlphaModbus] Auto-stop failed:', e.message);
      }
      this._dispatch = { active: false, mode: null, watts: 0, endTime: null, _timer: null };
    }, ms);

    // Prevent the timer from keeping the Node process alive on graceful shutdown
    if (_timer.unref) _timer.unref();

    this._dispatch = { active: true, mode, watts, endTime, _timer };
  }

  /**
   * Cancels the active timer (if any) and resets _dispatch state to idle.
   */
  _clearTimer() {
    if (this._dispatch._timer) {
      clearTimeout(this._dispatch._timer);
    }
    this._dispatch = { active: false, mode: null, watts: 0, endTime: null, _timer: null };
  }
}

export default new AlphaModbusAPI();