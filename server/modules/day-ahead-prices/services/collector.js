// modules/day-ahead-prices/services/collector.js
//
// Wijzigingen t.o.v. MySQL-versie:
//   ON DUPLICATE KEY UPDATE ... = VALUES() →  ON CONFLICT(...) DO UPDATE SET ... = excluded.
//   NOW()                                  →  datetime('now')
//   CURRENT_TIMESTAMP                      →  datetime('now')
//   STDDEV(price_eur_per_kwh)              →  verwijderd (niet beschikbaar in SQLite)

import api from './api.js';
import db from '../../../core/database.js';
import settingsService from '../../../core/system/services/settingsService.js';
import { padName } from '../../../core/utils/logger.js';
const PREFIX = padName('Day-Ahead-prices');

class DayAheadPricesCollector {
  constructor() {
    this.name             = 'day-ahead-prices';
    this.lastError        = null;
    this.lastRun          = null;
    this.lastFetchRecords = 0;
    this.retryTimer       = null;
    this.retryCount       = 0;
    this.maxRetries       = 10;
  }

  // ── Collect ────────────────────────────────────────────────────────────────

  async collect() {
    this.lastError = null;
    let recordsCollected = 0;

    try {
      const now = new Date();

      // Reset retry teller bij nieuwe dag
      if (this.lastRun && this.lastRun.getDate() !== now.getDate()) {
        console.log(`\x1b[33m   • ${PREFIX} - New day detected - resetting retry counter/timer\x1b[37m`);
        this.retryCount = 0;
        this.clearRetryTimer();
      }

      const settings = await settingsService.getCategory('day-ahead-prices');

      if (!settings || settings.enabled === false) {
        console.log(`\x1b[31m   • ${PREFIX} - Day-Ahead Prices: Disabled in settings/configuration\x1b[37m`);
        return false;
      }

      const {
        bidding_zone,
        country_code,
        fetch_days           = 10,
        fetch_interval_hours = 4,
        retry_max            = 10,
        last_fetch           = null,
      } = settings;

      if (!bidding_zone) {
        this.lastError = 'Missing bidding_zone in settings';
        console.error(`\x1b[31m   • ${PREFIX} - Day-Ahead Prices: Missing bidding_zone/configuration\x1b[37m`);
        return false;
      }

      this.maxRetries = retry_max;

      // Controleer of het interval verstreken is
      if (last_fetch && !this.retryTimer) {
        const lastFetchDate       = new Date(last_fetch);
        const hoursSinceLastFetch = (now - lastFetchDate) / (1000 * 60 * 60);

        if (hoursSinceLastFetch < fetch_interval_hours) {
          const nextFetchIn = Math.round((fetch_interval_hours - hoursSinceLastFetch) * 60);
          console.log(`\x1b[37m   • ${PREFIX} - ${now.toISOString()} - Skipping - last fetch was ${Math.round(hoursSinceLastFetch * 10) / 10}h ago (interval: ${fetch_interval_hours}h, next in ~${nextFetchIn}min)`);
          return true;
        }
      }

      const { startDate, endDate } = this.getDateRange(fetch_days);

      const prices = await api.getDayAheadPrices(bidding_zone, startDate, endDate);

      recordsCollected = await this.storePrices(prices, country_code || bidding_zone, bidding_zone);

      this.lastRun          = new Date();
      this.lastFetchRecords = recordsCollected;

      await this.updateLastFetchInfo(recordsCollected);
      await this.checkAndSetupRetryIfNeeded(bidding_zone);

      return true;

    } catch (error) {
      this.lastError = error.message;
      console.error(`\x1b[31m   • ${PREFIX} - Day-Ahead-prices - Error:`, error.message, '\x1b[37m');
      return false;
    }
  }

  // ── updateLastFetchInfo ────────────────────────────────────────────────────
  //
  // Wijziging:
  //   ON DUPLICATE KEY UPDATE ... = ?, updated_at = NOW()
  //   → ON CONFLICT(category, setting_key) DO UPDATE SET
  //       setting_value = excluded.setting_value,
  //       updated_at    = datetime('now')

  async updateLastFetchInfo(recordsCollected) {
    try {
      const now = new Date().toISOString();

      await db.pool.query(`
        INSERT INTO system_settings
          (category, setting_key, setting_value, value_type, description)
        VALUES ('day-ahead-prices', 'last_fetch', ?, 'string', 'Last successful fetch datetime')
        ON CONFLICT(category, setting_key) DO UPDATE SET
          setting_value = excluded.setting_value,
          updated_at    = datetime('now')
      `, [now]);

      await db.pool.query(`
        INSERT INTO system_settings
          (category, setting_key, setting_value, value_type, description)
        VALUES ('day-ahead-prices', 'last_fetch_records', ?, 'number', 'Records collected in last fetch')
        ON CONFLICT(category, setting_key) DO UPDATE SET
          setting_value = excluded.setting_value,
          updated_at    = datetime('now')
      `, [String(recordsCollected)]);

    } catch (error) {
      console.warn(`\x1b[31m   • ${PREFIX} - Could not update last fetch info:`, error.message, '\x1b[37m');
    }
  }

  // ── getDateRange ───────────────────────────────────────────────────────────

  getDateRange(fetchDays = 10) {
    const now = new Date();

    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - fetchDays);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 2);
    endDate.setHours(0, 0, 0, 0);

    return { startDate, endDate };
  }

  // ── storePrices ────────────────────────────────────────────────────────────
  //
  // Wijziging:
  //   ON DUPLICATE KEY UPDATE ... updated_at = CURRENT_TIMESTAMP
  //   → ON CONFLICT(datetime, bidding_zone) DO UPDATE SET
  //       price_eur_per_mwh = excluded.price_eur_per_mwh,
  //       price_eur_per_kwh = excluded.price_eur_per_kwh,
  //       updated_at        = datetime('now')

  async storePrices(prices, countryCode, biddingZone) {
    if (!prices || prices.length === 0) {
      throw new Error('No price data received from API');
    }

    let recordsStored = 0;

    try {
      for (const price of prices) {
        const datetimeStr = price.datetime.toISOString().slice(0, 19).replace('T', ' ');

        await db.pool.query(`
          INSERT INTO day_ahead_prices (
            datetime,
            price_eur_per_mwh,
            price_eur_per_kwh,
            country_code,
            bidding_zone,
            data_source
          ) VALUES (?, ?, ?, ?, ?, 'energy-charts')
          ON CONFLICT(datetime, bidding_zone) DO UPDATE SET
            price_eur_per_mwh = excluded.price_eur_per_mwh,
            price_eur_per_kwh = excluded.price_eur_per_kwh,
            updated_at        = datetime('now')
        `, [
          datetimeStr,
          price.priceEurPerMWh,
          price.priceEurPerKWh,
          countryCode,
          biddingZone,
        ]);

        recordsStored++;
      }

      return recordsStored;

    } catch (error) {
      throw new Error(`Failed to store prices in database: ${error.message}`);
    }
  }

  // ── Lees-queries ───────────────────────────────────────────────────────────
  // Geen MySQL-specifieke syntax — werken ongewijzigd met de shim.

  async getPricesForDate(date, biddingZone = 'NL') {
    const [rows] = await db.pool.query(`
      SELECT
        datetime,
        price_eur_per_kwh,
        price_eur_per_mwh,
        bidding_zone,
        country_code
      FROM day_ahead_prices
      WHERE date(datetime) = ?
        AND bidding_zone = ?
      ORDER BY datetime ASC
    `, [date, biddingZone]);

    return rows;
  }

  async getExtremeHours(date, biddingZone = 'NL', topN = 3) {
    const [cheapest] = await db.pool.query(`
      SELECT datetime, price_eur_per_kwh, price_eur_per_mwh
      FROM day_ahead_prices
      WHERE date(datetime) = ?
        AND bidding_zone = ?
      ORDER BY price_eur_per_kwh ASC
      LIMIT ?
    `, [date, biddingZone, topN]);

    const [expensive] = await db.pool.query(`
      SELECT datetime, price_eur_per_kwh, price_eur_per_mwh
      FROM day_ahead_prices
      WHERE date(datetime) = ?
        AND bidding_zone = ?
      ORDER BY price_eur_per_kwh DESC
      LIMIT ?
    `, [date, biddingZone, topN]);

    return { cheapest, expensive };
  }

  // ── getPriceSummary ────────────────────────────────────────────────────────
  //
  // Wijziging:
  //   STDDEV(price_eur_per_kwh) verwijderd — SQLite heeft geen STDDEV().
  //   price_std_dev wordt als null teruggegeven.

  async getPriceSummary(date, biddingZone = 'NL') {
    const [rows] = await db.pool.query(`
      SELECT
        AVG(price_eur_per_kwh) AS avg_price,
        MIN(price_eur_per_kwh) AS min_price,
        MAX(price_eur_per_kwh) AS max_price,
        COUNT(*)               AS hours_count
      FROM day_ahead_prices
      WHERE date(datetime) = ?
        AND bidding_zone = ?
    `, [date, biddingZone]);

    return rows[0]
      ? { ...rows[0], price_std_dev: null }
      : { avg_price: null, min_price: null, max_price: null, price_std_dev: null, hours_count: 0 };
  }

  async getCurrentPrice(biddingZone = 'NL') {
    const now         = new Date();
    const currentHour = new Date(now);
    currentHour.setMinutes(0, 0, 0);

    const datetimeStr = currentHour.toISOString().slice(0, 19).replace('T', ' ');

    const [rows] = await db.pool.query(`
      SELECT datetime, price_eur_per_kwh, price_eur_per_mwh
      FROM day_ahead_prices
      WHERE datetime = ?
        AND bidding_zone = ?
    `, [datetimeStr, biddingZone]);

    return rows[0] || null;
  }

  // ── Retry logica ───────────────────────────────────────────────────────────

  async checkAndSetupRetryIfNeeded(biddingZone) {
    try {
      const now         = new Date();
      const currentHour = now.getHours();

      if (currentHour < 14) {
        console.log(`\x1b[93m   • ${PREFIX} - Before 14:00 - tomorrow's prices may not be published yet\x1b[37m`);
        return;
      }

      const tomorrow     = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowDate = tomorrow.toISOString().split('T')[0];

      const tomorrowPrices = await this.getPricesForDate(tomorrowDate, biddingZone);

      if (tomorrowPrices.length >= 24) {
        this.clearRetryTimer();
        console.log(`\x1b[33m   • ${PREFIX} - Tomorrow's prices available (${tomorrowPrices.length} hours)\x1b[37m`);
        this.retryCount = 0;
        return;
      }

      if (tomorrowPrices.length > 0) {
        console.log(`\x1b[31m   • ${PREFIX} - Tomorrow's prices incomplete (${tomorrowPrices.length}/24 hours)\x1b[37m`);
      } else {
        console.log(`\x1b[31m   • Tomorrow's prices not yet available\x1b[37m`);
      }

      if (!this.retryTimer && this.retryCount < this.maxRetries) {
        this.setupHourlyRetry();
      } else if (this.retryCount >= this.maxRetries) {
        console.log(`\x1b[31m   • Max retries (${this.maxRetries}) reached - stopping retries\x1b[37m`);
      }

    } catch (error) {
      console.error('\x1b[31m   • Error checking tomorrow\'s data:', error.message, '\x1b[37m');
    }
  }

  setupHourlyRetry() {
    this.clearRetryTimer();

    const retryInterval = 60 * 60 * 1000;
    const nextRetryTime = new Date(Date.now() + retryInterval);

    console.log(`\x1b[37m   • ${PREFIX} - Setting up hourly retry (attempt ${this.retryCount + 1}/${this.maxRetries})`);
    console.log(`\x1b[37m   • ${PREFIX} - Next retry at: ${nextRetryTime.toLocaleTimeString('nl-NL')}`);

    this.retryTimer = setTimeout(async () => {
      this.retryCount++;
      console.log(`\x1b[37m   • ${PREFIX} - Retry attempt ${this.retryCount}/${this.maxRetries}`);
      try {
        await this.collect();
      } catch (error) {
        console.error(`\x1b[31m   • ${PREFIX} - Retry collection failed:`, error.message, '\x1b[37m');
      }
    }, retryInterval);
  }

  clearRetryTimer() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  getStatus() {
    return {
      name:             this.name,
      lastRun:          this.lastRun,
      lastFetch:        this.lastRun ? this.lastRun.toISOString() : null,
      lastFetchRecords: this.lastFetchRecords,
      lastError:        this.lastError,
      healthy:          this.lastError === null,
      retrying:         this.retryTimer !== null,
      retryCount:       this.retryCount,
      maxRetries:       this.maxRetries,
      apiInfo:          api.getAPIInfo(),
    };
  }

  async testConnection() {
    console.log(`\x1b[37m   • ${PREFIX} - Testing Energy Charts API connection...`);
    const health = await api.healthCheck();
    if (health.available) {
      console.log(`\x1b[37m   • ${PREFIX} - API is available`);
    } else {
      console.log(`\x1b[31m   • ${PREFIX} - API is unavailable:`, health.error, '\x1b[37m');
    }
    return health;
  }

  getSupportedZones() {
    return api.getSupportedZones();
  }
}

export default new DayAheadPricesCollector();