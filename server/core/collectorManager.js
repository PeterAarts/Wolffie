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

const FALLBACK_INTERVAL = 30000; // 30 s — used when nothing else is configured
const MAX_CONSECUTIVE_ERRORS = 5; // pause a collector after this many back-to-back failures

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
    //   paused:            boolean        // true after MAX_CONSECUTIVE_ERRORS
    // }
    this.schedules = new Map();
    this.isRunning = false;
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
      paused:            false
    });

    //console.log(`   • Registered collector: ${manifest.name} (default interval: ${manifest.collector?.interval || FALLBACK_INTERVAL}ms)`);
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
    // Convert the entries to names and join them with a separator

    for (const [id, entry] of this.schedules) {
      // Check database for enabled status
      const isEnabled = await this.isModuleEnabled(id);
      entry.enabled = isEnabled; // Update the entry with database value
      
      //console.log(`   - Starting: ${entry.name} (interval: ${entry.interval / 1000}s)`);
      if (!isEnabled) {
        console.log(`\x1b[91m   - Skipped (disabled): ${entry.name} \x1b[37m`);
        continue;
      }

      // Resolve final interval from device_settings if available
      entry.interval = await this._resolveInterval(id, entry.interval);
      // Immediate first collection
      await this._runCollector(id);
      // Arm the first scheduled timeout (next run after interval)
      this._armNext(id);
    }

    console.log('\x1b[32m   • all collectors started\n \x1b[37m');
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

    // Clear existing timer
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }

    // Reset error state
    entry.consecutiveErrors = 0;
    entry.paused = false;
    entry.lastError = null;

    // Re-resolve interval
    entry.interval = await this._resolveInterval(moduleId, entry.interval);

    console.log(` - CollectorManager: restarting ${entry.name} (interval: ${entry.interval / 1000}s)`);

    // Immediate collect + re-arm
    await this._runCollector(moduleId);
    this._armNext(moduleId);
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

      //console.log(`   └ ${entry.name}: ${success ? '✅' : '⚠️'} (${elapsed}ms)`);

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
   */
  _checkPause(entry) {
    if (entry.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS && !entry.paused) {
      entry.paused = true;
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      console.warn(`\x1b[93m   • ${entry.name}: paused after ${MAX_CONSECUTIVE_ERRORS} consecutive errors. Use restart('${entry.id}') to resume.  \x1b[37m`);
    }
  }

  // ─── Internal: interval resolution ──────────────────────────────

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
//          console.log(`   • ${moduleId}: using system_settings interval (${dbInterval}ms)`);
          return dbInterval;
        }
      }
    } catch (error) {
      // system_settings table might not exist yet or query failed —
      // fall through to manifest default silently
      console.log(`\x1b[91m   • ${moduleId}: system_settings lookup failed (${error.message}), using manifest default\x1b[37m `);
    }

    //console.log(`\x1b[37m   • ${moduleId} - ${new Date().toISOString()} - using manifest default interval (${manifestDefault}ms)\x1b[37m `);
    return manifestDefault;
  }
}

export default new CollectorManager();