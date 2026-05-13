// core/collectorManager.js
//
// Owns the timing lifecycle for all module collectors.
// Each module gets an independent setTimeout chain — no setInterval, no drift.
//
// Interval resolution order (first non-null wins):
//   1. device_settings.poll_interval  (per-device DB override)
//   2. manifest.json → collector.interval
//   3. FALLBACK_INTERVAL (30 000 ms)
//
// Module collector contract (what each collector.js must expose):
//   collect()   → async, does one poll cycle, returns true/false
//   getStatus() → { lastCollection, lastError, consecutiveErrors, ... }

import db from './database.js';
import capabilityRegistry from './capabilityRegistry.js';
import settingsService from './system/services/settingsService.js';
import { padName } from './utils/logger.js';
import { localTimestamp } from './utils/localTimestamp.js';
const PREFIX = padName('CollectorManager');

const FALLBACK_INTERVAL                  = 30000; // 30 s — used when nothing else is configured
const MAX_CONSECUTIVE_ERRORS             = 5;     // pause a collector after this many back-to-back failures
const DERIVED_METRICS_INTERVAL           = 15000; // 15 s — derived load calculation cadence
const DEFAULT_COLLECTOR_RESTART_MINUTES  = 30;    // fallback if system_settings not found

class CollectorManager {
  constructor() {
    // Map<moduleId, ScheduleEntry>
    // ScheduleEntry = {
    //   id:                string,        // e.g. 'alphaess-cloud'
    //   name:              string,        // human-readable from manifest
    //   collector:         object,        // the imported collector instance
    //   interval:          number,        // resolved poll interval in ms
    //   enabled:           boolean,
    //   timer:             Timeout|null,  // current pending setTimeout handle
    //   lastRun:           Date|null,
    //   nextRun:           Date|null,
    //   lastError:         string|null,
    //   consecutiveErrors: number,
    //   paused:            boolean,       // true after MAX_CONSECUTIVE_ERRORS
    //   recoveryTimer:     Timeout|null,  // one-shot auto-restart timer
    // }
    this.schedules = new Map();
    this.isRunning = false;

    // Derived metrics state
    this._derivedTimer     = null;
    this._derivedLastRun   = null;
    this._derivedLastError = null;

    // Resolved at start() from system_settings — cached for the session
    this._collectorRestartMs = DEFAULT_COLLECTOR_RESTART_MINUTES * 60 * 1000;
  }

  /**
   * Check if a module is enabled in the database
   * @param {string} moduleId - The module ID to check
   * @returns {Promise<boolean>} - True if enabled, false otherwise
   */
  async isModuleEnabled(moduleId) {
    try {
      const [rows] = await db.pool.query(
        `SELECT setting_value FROM system_settings 
         WHERE module_id = ? AND setting_key = 'enabled' 
         LIMIT 1`,
        [moduleId]
      );

      if (rows.length > 0) {
        const value = rows[0].setting_value;
        // Handle both string 'true'/'false' and boolean values
        return value === true || value === 'true' || value === '1' || value === 1;
      }

      // If no setting found, module is disabled by default for safety
      return false;
    } catch (error) {
      console.warn(` - ⚠️  Failed to check enabled status for ${moduleId}:`, error.message);
      // On error, assume disabled for safety
      return false;
    }
  }

  // ─── Public API ─────────────────────────────────────────────────

  /**
   * Register a module collector from a loaded module object.
   * Call once per module during server startup, before start().
   *
   * @param {object} module  – the module's default export (has .manifest attached by moduleLoader)
   */
  register(module) {
    const manifest = module.manifest;
    const loader='';
    if (!manifest?.capabilities?.dataCollection) {
      return; // Module doesn't do data collection — nothing to register
    }

    if (typeof module.collect !== 'function') {
      console.warn(` - ⚠️  CollectorManager: ${manifest?.id || 'unknown'} has dataCollection capability but no collect() method — skipped`);
      return;
    }

    const id = manifest.id;

    this.schedules.set(id, {
      id,
      name:              manifest.name,
      collector:         module,
      interval:          manifest.collector?.interval || FALLBACK_INTERVAL,
      enabled:           manifest.collector?.enabled !== false,
      timer:             null,
      lastRun:           null,
      nextRun:           null,
      lastError:         null,
      consecutiveErrors: 0,
      paused:            false,
      recoveryTimer:     null,
    });

    console.log(`     - Registered collector: ${manifest.name} (default interval: ${manifest.collector?.interval || FALLBACK_INTERVAL}ms)`);
  }

  /**
   * Start all registered collectors.
   * For each enabled module: resolves the final interval (checking device_settings),
   * does an immediate first collect, then arms the setTimeout chain.
   */
  async start() {
    if (this.isRunning) {
      console.log('- CollectorManager already running');
      return;
    }
    this.isRunning = true;

    // Resolve auto-restart period from system_settings
    await this._resolveRestartInterval();

    // Phase 1 — resolve enabled state and interval for every module (DB reads,
    // fast and sequential so logs appear in a predictable order).
    for (const [id, entry] of this.schedules) {
      const isEnabled = await this.isModuleEnabled(id);
      entry.enabled = isEnabled;

      if (!isEnabled) {
        console.log(`\x1b[91m   - Skipped (disabled): ${entry.name} \x1b[37m`);
        continue;
      }

      entry.interval = await this._resolveInterval(id, entry.interval);
      console.log(`\x1b[37m   - Collector activated: ${entry.name} (interval: ${entry.interval / 1000}s)\x1b[37m`);
    }

    // Phase 2 — fire all initial collections concurrently and WITHOUT awaiting.
    // Each collector arms its own next timer after its first run completes.
    // This makes start() return immediately so server init can continue
    // (aggregatorService, strategyManager) without waiting for slow collectors.
    for (const [id, entry] of this.schedules) {
      if (!entry.enabled) continue;

      this._runCollector(id)
        .then(() => this._armNext(id))
        .catch((err) => {
          console.error(`\x1b[91m   - ${entry.name}: initial collect failed — ${err.message}\x1b[37m`);
          this._armNext(id); // still arm next even after a hard failure
        });
    }

    // Arm derived metrics — only when explicitly enabled via core setting.
    // Disabled by default: the current formula has known sign-convention issues
    // with bidirectional flows. Users opt in via Settings → Core → Data Collection.
    const dc = await settingsService.getCategory('data_collection');
    if (dc?.derive_home_load === true || dc?.derive_home_load === '1' || dc?.derive_home_load === 1) {
      this._derivedTimer = setTimeout(
        () => this._runDerivedMetrics(),
        DERIVED_METRICS_INTERVAL
      );
      console.log(`\x1b[37m   - Derived metrics armed (interval: ${DERIVED_METRICS_INTERVAL / 1000}s)\x1b[37m`);
    } else {
      console.log(`\x1b[37m   - Derived metrics: disabled (enable via Core Settings → Data Collection)\x1b[37m`);
    }

    console.log('\x1b[32m   • all collectors fired (running in background)\n \x1b[37m');
  }

  /**
   * Stop all collectors and clear all pending timers.
   */
  async stop() {
    console.log('\x1b[91m   - CollectorManager: stopping all collectors...\x1b[37m');

    for (const [id, entry] of this.schedules) {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      // Cancel any pending auto-recovery timer
      if (entry.recoveryTimer) {
        clearTimeout(entry.recoveryTimer);
        entry.recoveryTimer = null;
      }
    }

    // Stop derived metrics timer
    if (this._derivedTimer) {
      clearTimeout(this._derivedTimer);
      this._derivedTimer = null;
    }

    this.isRunning = false;
    console.log('\x1b[91m   - CollectorManager: all collectors stopped\x1b[37m');
  }

  /**
   * Get the live in-memory schedule state for all modules.
   * Suitable for a status/health API endpoint.
   */
  getSchedules() {
    const result = [];

    for (const [id, entry] of this.schedules) {
      result.push({
        id:                entry.id,
        name:              entry.name,
        enabled:           entry.enabled,
        paused:            entry.paused,
        interval:          entry.interval,
        lastRun:           entry.lastRun,
        nextRun:           entry.nextRun,
        lastError:         entry.lastError,
        consecutiveErrors: entry.consecutiveErrors,
        // Merge in whatever the collector itself reports
        ...(typeof entry.collector.getStatus === 'function' ? entry.collector.getStatus() : {})
      });
    }

    return result;
  }

  /**
   * Restart a single collector (re-resolve interval, immediate collect, re-arm).
   */
  async restart(moduleId) {
    const entry = this.schedules.get(moduleId);
    if (!entry) {
      throw new Error(`CollectorManager: no collector registered as '${moduleId}'`);
    }

    // Clear existing timers
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (entry.recoveryTimer) {
      clearTimeout(entry.recoveryTimer);
      entry.recoveryTimer = null;
    }

    // Reset error state
    entry.consecutiveErrors = 0;
    entry.paused = false;
    entry.lastError = null;

    // Re-resolve interval
    entry.interval = await this._resolveInterval(moduleId, entry.interval);

    console.log(` - CollectorManager: restarting ${entry.name} (interval: ${entry.interval / 1000}s)`);

    // Fire non-blocking
    this._runCollector(moduleId)
      .then(() => this._armNext(moduleId))
      .catch((err) => {
        console.error(`\x1b[91m   ❌ ${entry.name}: collect after restart failed — ${err.message}\x1b[37m`);
        this._armNext(moduleId);
      });
  }

  /**
   * Enable or disable a single collector at runtime.
   * Called by the settings route when a module is activated/deactivated.
   * Persists nothing — the caller is responsible for writing to system_settings first.
   *
   * @param {string} moduleId
   * @param {boolean} enabled
   */
  async setEnabled(moduleId, enabled) {
    const entry = this.schedules.get(moduleId);
    if (!entry) {
      throw new Error(`CollectorManager: no collector registered as '${moduleId}'`);
    }

    // Clear any running timers regardless of direction
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (entry.recoveryTimer) {
      clearTimeout(entry.recoveryTimer);
      entry.recoveryTimer = null;
    }

    entry.enabled = enabled;

    if (enabled) {
      // Reset error state so a freshly enabled collector starts clean
      entry.consecutiveErrors = 0;
      entry.paused = false;
      entry.lastError = null;

      // Re-resolve interval (settings may have changed since startup)
      entry.interval = await this._resolveInterval(moduleId, entry.interval);

      console.log(`\x1b[32m   ▶ Collector enabled: ${entry.name} (interval: ${entry.interval / 1000}s)\x1b[37m`);

      // Fire non-blocking so the settings route returns immediately
      this._runCollector(moduleId)
        .then(() => this._armNext(moduleId))
        .catch((err) => {
          console.error(`\x1b[91m   ❌ ${entry.name}: collect after enable failed — ${err.message}\x1b[37m`);
          this._armNext(moduleId);
        });
    } else {
      entry.paused = false; // not paused, just disabled
      entry.nextRun = null;
      console.log(`\x1b[91m   ⏹ Collector disabled: ${entry.name}\x1b[37m`);
    }

    return {
      id:      entry.id,
      name:    entry.name,
      enabled: entry.enabled,
      paused:  entry.paused,
    };
  }

  // ─── Internal: timing ───────────────────────────────────────────

  /**
   * Arm the next setTimeout for a given module.
   * This is the core of the "no drift" pattern:
   * the next timer is set only AFTER the current collect() finishes.
   */
  _armNext(moduleId) {
    const entry = this.schedules.get(moduleId);
    if (!entry || !this.isRunning || !entry.enabled || entry.paused) return;

    entry.nextRun = new Date(Date.now() + entry.interval);

    entry.timer = setTimeout(async () => {
      entry.timer = null; // Clear handle before running — _armNext will set the next one
      await this._runCollector(moduleId);
      this._armNext(moduleId); // Re-arm for next cycle
    }, entry.interval);
  }

  /**
   * Execute one collection cycle for a module.
   * Updates lastRun, error tracking, and pauses on too many failures.
   */
  async _runCollector(moduleId) {
    const entry = this.schedules.get(moduleId);
    if (!entry) return;

    const startTime = Date.now();

    try {
      const success = await entry.collector.collect();
      const elapsed = Date.now() - startTime;

      entry.lastRun = new Date();

      if (success) {
        entry.consecutiveErrors = 0;
        entry.lastError = null;
        entry.paused = false;
      } else {
        // collect() returned false — treat as a soft failure
        entry.consecutiveErrors++;
        entry.lastError = entry.collector.lastError || 'collect() returned false';
        this._checkPause(entry);
      }

    } catch (error) {
      // collect() threw — hard failure
      entry.lastRun = new Date();
      entry.consecutiveErrors++;
      entry.lastError = error.message;
      console.error(`\x1b[91m -   ❌ ${entry.name}: ${error.message} \x1b[37m`);
      this._checkPause(entry);
    }
  }

  /**
   * Pause a collector if it has hit the consecutive error limit.
   * Arms a one-shot recovery timer based on system_settings
   * category='data_collection', setting_key='collector_restart_minutes'.
   */
  _checkPause(entry) {
    if (entry.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS && !entry.paused) {
      entry.paused = true;
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }

      const restartMinutes = Math.round(this._collectorRestartMs / 60000);
      console.warn(
        `\x1b[93m   • ${entry.name}: paused after ${MAX_CONSECUTIVE_ERRORS} consecutive errors. ` +
        `Auto-restart in ${restartMinutes}m.\x1b[37m`
      );

      // Cancel any existing recovery timer before arming a new one
      if (entry.recoveryTimer) {
        clearTimeout(entry.recoveryTimer);
      }

      entry.recoveryTimer = setTimeout(() => {
        entry.recoveryTimer = null;
        if (!this.isRunning) return;
        console.log(`\x1b[32m   • ${entry.name}: auto-recovering after ${restartMinutes}m pause\x1b[37m`);
        entry.consecutiveErrors = 0;
        entry.paused            = false;
        entry.lastError         = null;
        this._runCollector(entry.id)
          .then(() => this._armNext(entry.id))
          .catch((err) => {
            console.error(`\x1b[91m   ❌ ${entry.name}: auto-recovery failed — ${err.message}\x1b[37m`);
            this._armNext(entry.id);
          });
      }, this._collectorRestartMs);
    }
  }

  // ─── Derived Metrics ────────────────────────────────────────────────────────

  /**
   * Derives load_power and load_energy_today from capability registry readings.
   * Writes a synthetic energy_snapshots row with source = 'wolffie-core'.
   * Owns only load_power and load_energy_today — all other fields NULL.
   *
   * Sign conventions (canonical across all modules):
   *   solar    always positive (production)
   *   battery  positive = charging (absorbing power), negative = discharging (supplying power)
   *   grid     positive = importing, negative = exporting
   *
   * load_power formula:
   *   load = solar - battery + grid
   *
   *   Rationale:
   *     - Solar produces power available to home               → +solar
   *     - Battery charging consumes power (raises load)        → -battery when positive
   *     - Battery discharging supplies power (lowers net load) → -battery when negative = +
   *     - Grid import supplies power to home                   → +grid when positive
   *     - Grid export removes surplus from home                → +grid when negative = -
   *
   * load_energy_today:
   *   load_today = solar_today + (import_today - export_today) + (discharge_today - charge_today)
   */
  async _runDerivedMetrics() {
    if (!this.isRunning) return;

    try {
      // ── Read from capability registry ────────────────────────────────────
      const [solar, battery, grid] = await Promise.all([
        capabilityRegistry.has('solar:read')   ? capabilityRegistry.get('solar:read')()   : null,
        capabilityRegistry.has('battery:read') ? capabilityRegistry.get('battery:read')() : null,
        capabilityRegistry.has('grid:read')    ? capabilityRegistry.get('grid:read')()    : null,
      ]);

      const solarPower   = solar?.power   ?? 0;
      const batteryPower = battery?.power ?? 0;
      const gridPower    = grid?.power    ?? 0;

      // ── Derive live load ─────────────────────────────────────────────────
      // battery positive = charging (consuming power) → subtract from load
      // battery negative = discharging (supplying power) → subtract negative = add to load
      const loadPower = Math.max(0, solarPower - batteryPower + gridPower);

      // ── Derive daily load total ──────────────────────────────────────────
      const solarToday     = solar?.energy_today      ?? 0;
      const importToday    = grid?.import_today       ?? 0;
      const exportToday    = grid?.export_today       ?? 0;
      const chargeToday    = battery?.charge_today    ?? 0;
      const dischargeToday = battery?.discharge_today ?? 0;

      const loadEnergyToday = Math.max(0,
        solarToday +
        (importToday    - exportToday) +
        (dischargeToday - chargeToday)
      );

      // ── Write synthetic snapshot ─────────────────────────────────────────
      // All energy_snapshots rows use local time (CET/CEST without offset marker)
      // to match the alphaess-cloud and homewizard collectors. Earlier versions
      // wrote UTC here via .toISOString(); that put wolffie-core rows in different
      // hour buckets than other sources, breaking the aggregator's strftime-based
      // bucketing for all consumers downstream.
      const localNow = localTimestamp();

      await db.pool.query(
        `INSERT INTO energy_snapshots (
          timestamp, source, device_id,
          load_power, load_energy_today
        ) VALUES (?, 'wolffie-core', 'derived', ?, ?)
        ON CONFLICT(timestamp, source) DO UPDATE SET
          load_power        = excluded.load_power,
          load_energy_today = excluded.load_energy_today`,
        [localNow, Math.round(loadPower), loadEnergyToday]
      );

      this._derivedLastRun   = new Date();
      this._derivedLastError = null;

      console.log(
        `   • ${PREFIX} – Load=${Math.round(loadPower)}W` +
        ` (Solar=${solarPower}W Battery=${batteryPower}W Grid=${gridPower}W)` +
        ` LoadToday=${loadEnergyToday.toFixed(3)}kWh`
      );

    } catch (err) {
      this._derivedLastError = err.message;
      console.error(`\x1b[31m   • ${PREFIX} derived metrics failed: ${err.message}\x1b[37m`);
    }

    // Re-arm — only if still running
    if (this.isRunning) {
      this._derivedTimer = setTimeout(
        () => this._runDerivedMetrics(),
        DERIVED_METRICS_INTERVAL
      );
    }
  }

  // ─── Internal: interval resolution ──────────────────────────────

  /**
   * Resolve the auto-restart period from system_settings.
   * category='data_collection', setting_key='collector_restart_minutes'
   * Falls back to DEFAULT_COLLECTOR_RESTART_MINUTES if not found.
   */
  async _resolveRestartInterval() {
    try {
      const [rows] = await db.pool.query(
        `SELECT setting_value FROM system_settings
          WHERE category    = 'data_collection'
            AND setting_key = 'collector_restart_minutes'
          LIMIT 1`
      );
      if (rows.length > 0 && rows[0].setting_value) {
        const minutes = Number(rows[0].setting_value);
        if (minutes > 0) {
          this._collectorRestartMs = minutes * 60 * 1000;
          console.log(`\x1b[37m   - Collector auto-restart: ${minutes}m (from system_settings)\x1b[37m`);
          return;
        }
      }
    } catch (err) {
      console.warn(`   - collector_restart_minutes lookup failed: ${err.message}, using default`);
    }
    console.log(`\x1b[37m   - Collector auto-restart: ${DEFAULT_COLLECTOR_RESTART_MINUTES}m (default)\x1b[37m`);
  }

  /**
   * Resolve the effective poll interval for a module.
   *
   * Priority:
   *   1. system_settings.setting_value WHERE module_id = moduleId AND setting_key = 'poll_interval'
   *   2. The default passed in (from manifest.json)
   *
   * Returns the interval in milliseconds.
   */
  async _resolveInterval(moduleId, manifestDefault) {
    try {
      const [rows] = await db.pool.query(
        `SELECT setting_value FROM system_settings
         WHERE module_id = ? AND setting_key = 'poll_interval' 
         LIMIT 1`,
        [moduleId]
      );

      if (rows.length > 0 && rows[0].setting_value) {
        const dbInterval = Number(rows[0].setting_value);
        if (dbInterval > 0) {
          return dbInterval;
        }
      }
    } catch (error) {
      console.log(`\x1b[91m   • ${moduleId}: system_settings lookup failed (${error.message}), using manifest default\x1b[37m `);
    }

    return manifestDefault;
  }
}

export default new CollectorManager();