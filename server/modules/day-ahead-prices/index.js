// modules/day-ahead-prices/index.js
//
// Wijziging t.o.v. MySQL-versie:
//   DATE_ADD(?, INTERVAL ? HOUR)  →  datetime(?, '+' || ? || ' hours')

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import db from '../../core/database.js';
import collector from './services/collector.js';
import settingsService from '../../core/system/services/settingsService.js';
import capabilityRegistry from '../../core/capabilityRegistry.js';
import { padName } from '../../core/utils/logger.js';
const PREFIX = padName('Day-Ahead-prices');

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8')
);

const MODULE_ID = 'day-ahead-prices';
const PRIORITY  = 10;

class DayAheadPricesModule {
  constructor() {
    this.manifest    = manifest;
    this.initialized = false;
    this.config      = null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize() {
    if (this.initialized) return;

    try {
      console.log(`   - \x1b[93m${MODULE_ID} \x1b[37m`);

      this.config = await settingsService.getCategory(MODULE_ID);

      if (!this.config || this.config.enabled === false) {
        console.log(`     - ${MODULE_ID}: disabled in settings`);
        return;
      }

      if (!this.config.bidding_zone) {
        console.warn(`     - ${MODULE_ID}: missing bidding_zone — grid:pricing not registered`);
        return;
      }

      console.log(`     - Bidding zone: ${this.config.bidding_zone}`);

      this.routes = await this.getRoutes();
      this._registerCapabilities();

      this.initialized = true;
      console.log(`     - Capabilities registered \x1b[32m✓\x1b[37m`);

    } catch (error) {
      console.error(`\x1b[91m     - ${MODULE_ID}: initialize failed:`, error.message, '\x1b[37m');
      throw error;
    }
  }

  async collect() {
    return await collector.collect();
  }

  getStatus() {
    return {
      ...collector.getStatus(),
      initialized: this.initialized,
    };
  }

  async getRoutes() {
    try {
      const routesPath = path.join(__dirname, 'routes', 'index.js');
      if (fs.existsSync(routesPath)) {
        const m = await import(pathToFileURL(routesPath).href);
        return m.default;
      }
    } catch (e) {
      console.warn(`     - ${MODULE_ID}: route loading failed:`, e.message);
    }
    return null;
  }

  async reinitialize() {
    console.log(`   - ♻️  ${MODULE_ID}: reinitializing`);
    this.config = await settingsService.getCategory(MODULE_ID);

    if (this.config?.bidding_zone) {
      this._registerCapabilities();
    } else {
      capabilityRegistry.unregister(MODULE_ID);
    }
  }

  // ── Capability Registration ────────────────────────────────────────────────
  //
  // Wijziging:
  //   DATE_ADD(?, INTERVAL ? HOUR)  →  datetime(?, '+' || ? || ' hours')
  //
  // SQLite heeft geen DATE_ADD() functie. De aaneenschakeling
  // '+' || windowHours || ' hours' bouwt een geldig modifier-argument
  // voor datetime(), bijv. '+24 hours'.

  _registerCapabilities() {
    const biddingZone = this.config?.bidding_zone ?? 'NL';

    capabilityRegistry.register(
      'grid:pricing',
      async (body = {}) => {
        const windowHours = body.windowHours ?? 24;

        // SQLite accepteert geen Date-objecten als bind-parameter — altijd naar string converteren
        const windowStart = body.windowStart
          ? new Date(body.windowStart).toISOString().slice(0, 19).replace('T', ' ')
          : new Date().toISOString().slice(0, 19).replace('T', ' ');

        const [rows] = await db.pool.query(`
          SELECT
            datetime,
            price_eur_per_mwh,
            price_eur_per_kwh
          FROM day_ahead_prices
          WHERE datetime >= ?
            AND datetime <  datetime(?, '+' || ? || ' hours')
            AND bidding_zone = ?
          ORDER BY datetime ASC
        `, [windowStart, windowStart, windowHours, biddingZone]);

        const prices = rows.map(row => {
          const dt    = new Date(row.datetime);
          const price = Math.round(row.price_eur_per_kwh * 100 * 100) / 100;
          return {
            datetime: dt.toISOString(),
            hour:     dt.getHours(),
            minute:   dt.getMinutes(),
            price,
          };
        });

        const now         = new Date();
        const currentHour = now.getHours();
        const currentMin  = Math.floor(now.getMinutes() / 15) * 15;
        const currentSlot = prices.find(
          p => p.hour === currentHour && p.minute === currentMin
        );
        const currentPrice = currentSlot?.price
          ?? prices.find(p => p.hour === currentHour)?.price
          ?? null;

        return { prices, currentPrice };
      },
      PRIORITY,
      MODULE_ID
    );
  }
}

export default new DayAheadPricesModule();