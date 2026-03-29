// modules/day-ahead-prices/index.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import db from '../../core/database.js';
import collector from './services/collector.js';
import settingsService from '../../core/system/services/settingsService.js';
import capabilityRegistry from '../../core/capabilityRegistry.js';

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

      // Pre-load routes
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

  _registerCapabilities() {
    const biddingZone = this.config?.bidding_zone ?? 'NL';

    capabilityRegistry.register(
      'grid:pricing',
      async (body = {}) => {
        const windowHours = body.windowHours ?? 24;
        const windowStart = body.windowStart ?? new Date();

        // Fetch all 15-min slots covering the rolling window
        const [rows] = await db.pool.query(`
          SELECT
            datetime,
            price_eur_per_mwh,
            price_eur_per_kwh
          FROM day_ahead_prices
          WHERE datetime >= ?
            AND datetime <  DATE_ADD(?, INTERVAL ? HOUR)
            AND bidding_zone = ?
          ORDER BY datetime ASC
        `, [windowStart, windowStart, windowHours, biddingZone]);

        // Normalise to { datetime (ISO), hour, minute, price (ct/kWh) }
        const prices = rows.map(row => {
          const dt     = new Date(row.datetime);
          const price  = Math.round(row.price_eur_per_kwh * 100 * 100) / 100;
          return {
            datetime: dt.toISOString(),
            hour:     dt.getHours(),
            minute:   dt.getMinutes(),
            price,
          };
        });

        // Current price: match current quarter-hour slot
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