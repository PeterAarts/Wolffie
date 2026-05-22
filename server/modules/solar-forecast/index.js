// modules/solar-forecast/index.js
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import db from '../../core/database.js';
import collector from './services/collector.js';
import settingsService from '../../core/system/services/settingsService.js';
import capabilityRegistry from '../../core/capabilityRegistry.js';
import { padName } from '../../core/utils/logger.js';
const PREFIX = padName('Solar Forecast');

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const manifest = JSON.parse(readFileSync(join(__dirname, 'manifest.json'), 'utf-8'));

const MODULE_ID = 'solar-forecast';
const PRIORITY  = 10;

class SolarForecastModule {
  constructor() {
    this.manifest    = manifest;
    this.collector   = collector;
    this.initialized = false;
    this.config      = null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize() {
    if (this.initialized) return;

    try {
      console.log(`   - \x1b[93m${PREFIX} \x1b[37m`);
      this.config = await settingsService.getCategory(MODULE_ID);

      if (!this.config || this.config.enabled === false) {
        console.log(`     - ${PREFIX}: disabled in settings`);
        return;
      }

      if (!this.config.latitude || !this.config.longitude) {
        console.warn(`     - ${PREFIX}: missing latitude/longitude — solar:forecast not registered`);
        return;
      }

      if (!this.config.kwp) {
        console.warn(`     - ${PREFIX}: missing panel power (kWp) — solar:forecast not registered`);
        return;
      }

      console.log(`     - Location: ${this.config.latitude}°, ${this.config.longitude}°`);
      console.log(`     - Panel power: ${this.config.kwp} kWp`);
      console.log(`     - Tilt: ${this.config.tilt ?? 'N/A'}°, Azimuth: ${this.config.azimuth ?? 'N/A'}°`);

      collector.config = this.config;  // ← THE FIX

      this.routes = await this._loadRoutes();
      this._registerCapabilities();

      this.initialized = true;
      console.log(`     - Capabilities registered \x1b[32m✓\x1b[37m`);

    } catch (error) {
      console.error(`\x1b[91m     - ${PREFIX}: initialize failed:`, error.message, '\x1b[37m');
      throw error;
    }
  }
  async collect() {
    return await this.collector.collect();
  }

  getStatus() {
    const cs = typeof this.collector.getStatus === 'function'
      ? this.collector.getStatus() : {};
    return {
      initialized:  this.initialized,
      enabled:      this.config?.enabled ?? false,
      hasConfig:    !!this.config,
      latitude:     this.config?.latitude,
      longitude:    this.config?.longitude,
      panelPower:   this.config?.kwp,
      tilt:         this.config?.tilt,
      azimuth:      this.config?.azimuth,
      collector: {
        lastRun:   cs.lastRun   ?? null,
        lastError: cs.lastError ?? null,
        healthy:   cs.healthy   !== false,
      },
    };
  }

  getRoutes() {
    return this.routes ?? null;
  }

  async _loadRoutes() {
    try {
      const routesPath = join(__dirname, 'routes', 'index.js');
      if (existsSync(routesPath)) {
        const m = await import(pathToFileURL(routesPath).href);
        return m.default;
      }
    } catch (e) {
      console.warn(`     - ${PREFIX}: route loading failed:`, e.message);
    }
    return null;
  }

  async reinitialize() {
    console.log(`   - ${PREFIX}: reinitializing with fresh settings`);
    this.config = await settingsService.getCategory(MODULE_ID);
    collector.config = this.config;

    if (this.config?.latitude && this.config?.longitude && this.config?.kwp) {
      this._registerCapabilities();
    } else {
      capabilityRegistry.unregister(MODULE_ID);
    }
  }

  // ── Capability Registration ────────────────────────────────────────────────

  _registerCapabilities() {
    capabilityRegistry.register(
      'solar:forecast',
      async (body = {}) => {
        const windowHours = body.windowHours ?? 24;
        const windowStart = body.windowStart ? new Date(body.windowStart) : new Date();
        const windowEnd   = new Date(windowStart.getTime() + windowHours * 60 * 60 * 1000);

        // Collect all calendar dates spanned by the window.
        // Use local date strings to match how slot_datetime is stored (local time, no TZ).
        const dates = [];
        const cursor = new Date(windowStart);
        cursor.setHours(0, 0, 0, 0);
        while (cursor <= windowEnd) {
          // Format as YYYY-MM-DD in local time (not UTC)
          const y  = cursor.getFullYear();
          const mo = String(cursor.getMonth() + 1).padStart(2, '0');
          const d  = String(cursor.getDate()).padStart(2, '0');
          dates.push(`${y}-${mo}-${d}`);
          cursor.setDate(cursor.getDate() + 1);
        }

        // Fetch hourly forecast slots for all dates in window
        const placeholders = dates.map(() => '?').join(',');
        const [rows] = await db.pool.query(`
          SELECT slot_datetime, hourly_wh, date
          FROM solar_forecast_hourly
          WHERE date IN (${placeholders})
          ORDER BY slot_datetime ASC
        `, dates);

        // Normalise — slot_datetime is stored as local time ("YYYY-MM-DD HH:00:00", no TZ).
        // mysql2 parses DATETIME columns into JS Date objects. Those Date objects represent
        // the correct local instant, so we extract parts with getHours() etc. (local),
        // then reconstruct with new Date(yr, mo-1, dy, hr, mn) which also uses local TZ.
        // Never use toISOString() on the raw DB Date — it outputs UTC and shifts by the offset.
        const hourly = rows
          .map(row => {
            // slot_datetime is stored as local time ("YYYY-MM-DD HH:00:00", no TZ).
            // mysql2 parses DATETIME columns into JS Date objects using UTC internally,
            // so toISOString() would shift by the UTC offset (e.g. -2h in CEST).
            // We must extract local parts using getFullYear/getMonth/getDate/getHours.
            let yr, mo, dy, hr, mn;
            if (row.slot_datetime instanceof Date) {
              yr = row.slot_datetime.getFullYear();
              mo = row.slot_datetime.getMonth() + 1;
              dy = row.slot_datetime.getDate();
              hr = row.slot_datetime.getHours();
              mn = row.slot_datetime.getMinutes();
            } else {
              // String "YYYY-MM-DD HH:MM:SS"
              const s = String(row.slot_datetime);
              yr = parseInt(s.slice(0, 4), 10);
              mo = parseInt(s.slice(5, 7), 10);
              dy = parseInt(s.slice(8, 10), 10);
              hr = parseInt(s.slice(11, 13), 10);
              mn = parseInt(s.slice(14, 16), 10);
            }

            const datePart  = `${yr}-${String(mo).padStart(2,'0')}-${String(dy).padStart(2,'0')}`;
            // Build local Date from parts — new Date(yr, mo-1, dy, hr, mn) uses local TZ
            const localDate = new Date(yr, mo - 1, dy, hr, mn, 0);

            return {
              datetime: localDate.toISOString(),   // UTC ISO — correct offset from local parts
              hour:     hr,                         // local hour — what strategies need
              date:     datePart,
              watts:    Math.round(parseFloat(row.hourly_wh) || 0),
            };
          })
          // Filter to only slots within the actual window
          .filter(s => {
            const t = new Date(s.datetime).getTime();
            return t >= windowStart.getTime() && t < windowEnd.getTime();
          });

        // Total forecast kWh across the window
        const totalWh  = hourly.reduce((sum, s) => sum + s.watts, 0);
        const totalKwh = Math.round(totalWh / 100) / 10;

        // Daily summaries for accuracy factor
        const [summaryRows] = await db.pool.query(
          `SELECT date, expected_kwh, actual_kwh, accuracy_percentage
           FROM solar_forecasts WHERE date IN (${placeholders})`,
          dates
        );

        return {
          hourly,
          totalKwh,
          dailySummaries: summaryRows,
          // Legacy: today's summary for backward compat
          expectedKwh:        parseFloat(summaryRows[0]?.expected_kwh)       || totalKwh,
          actualKwh:          parseFloat(summaryRows[0]?.actual_kwh)          ?? null,
          accuracyPercentage: parseFloat(summaryRows[0]?.accuracy_percentage) ?? null,
        };
      },
      PRIORITY,
      MODULE_ID
    );
  }
}

export default new SolarForecastModule();