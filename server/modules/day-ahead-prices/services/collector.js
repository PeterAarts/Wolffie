// modules/day-ahead-prices/services/collector.js
import api from './api.js';
import db from '../../../core/database.js';
import settingsService from '../../../core/system/services/settingsService.js';

/**
 * Day-Ahead Electricity Prices Collector
 * Uses Energy Charts API (Fraunhofer ISE) - No token required!
 */
class DayAheadPricesCollector {
  constructor() {
    this.name = 'day-ahead-prices';
    this.lastError = null;
    this.lastRun = null;
    this.lastFetchRecords = 0;
    this.retryTimer = null;
    this.retryCount = 0;
    this.maxRetries = 10;
  }

  /**
   * Main collection method called by collectorManager
   */
  async collect() {
    this.lastError = null;
    let recordsCollected = 0;

    try {
      // Reset retry count if it's a new day (after midnight)
      const now = new Date();
      if (this.lastRun && this.lastRun.getDate() !== now.getDate()) {
        console.log('\x1b[33m   • New day detected - resetting retry counter/timer\x1b[37m');
        this.retryCount = 0;
        this.clearRetryTimer();
      }

      // Load settings from database
      const settings = await settingsService.getCategory('day-ahead-prices');

      if (!settings || settings.enabled === false) {
        console.log('\x1b[31m   • Day-Ahead Prices: Disabled in settings/configuration\x1b[37m');
        return false;
      }

      // Read configurable settings with defaults
      const { 
        bidding_zone, 
        country_code,
        fetch_days = 10,
        fetch_interval_hours = 4,
        retry_max = 10,
        last_fetch = null
      } = settings;

      if (!bidding_zone) {
        this.lastError = 'Missing bidding_zone in settings';
        console.error('\x1b[31m   • Day-Ahead Prices: Missing bidding_zone/configuration\x1b[37m');
        return false;
      }

      // Update max retries from settings
      this.maxRetries = retry_max;

      // Check if enough time has passed since last fetch
      if (last_fetch && !this.retryTimer) {
        const lastFetchDate = new Date(last_fetch);
        const hoursSinceLastFetch = (now - lastFetchDate) / (1000 * 60 * 60);
        
        if (hoursSinceLastFetch < fetch_interval_hours) {
          const nextFetchIn = Math.round((fetch_interval_hours - hoursSinceLastFetch) * 60);
          console.log(`\x1b[37m   • Day-Ahead-pricing - ${new Date().toISOString()} - Skipping - last fetch was ${Math.round(hoursSinceLastFetch * 10) / 10}h ago (interval: ${fetch_interval_hours}h, next in ~${nextFetchIn}min)`);
          return true; // Return true (not an error, just not needed yet)
        }
      }

      // Determine date range using configurable fetch_days
      const { startDate, endDate } = this.getDateRange(fetch_days);

      // Fetch prices from Energy Charts API
      const prices = await api.getDayAheadPrices(
        bidding_zone,
        startDate,
        endDate
      );

      // Store prices in database
      recordsCollected = await this.storePrices(prices, country_code || bidding_zone, bidding_zone);

      this.lastRun = new Date();
      this.lastFetchRecords = recordsCollected;

      // Store last fetch info in system_settings
      await this.updateLastFetchInfo(recordsCollected);

      // Check if we got tomorrow's data
      await this.checkAndSetupRetryIfNeeded(bidding_zone);

      return true;

    } catch (error) {
      this.lastError = error.message;
      console.error('`\x1b[31m   • Day-Ahead-prices - Error:', error.message,'\x1b[37m');
      return false;
    }
  }

  /**
   * Store last fetch timestamp and record count in system_settings
   */
  async updateLastFetchInfo(recordsCollected) {
    try {
      const now = new Date().toISOString();

      // Upsert last_fetch datetime
      await db.pool.query(`
        INSERT INTO system_settings (category, setting_key, setting_value, value_type, description)
        VALUES ('day-ahead-prices', 'last_fetch', ?, 'string', 'Last successful fetch datetime')
        ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()
      `, [now, now]);

      // Upsert last_fetch_records count
      await db.pool.query(`
        INSERT INTO system_settings (category, setting_key, setting_value, value_type, description)
        VALUES ('day-ahead-prices', 'last_fetch_records', ?, 'number', 'Records collected in last fetch')
        ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()
      `, [String(recordsCollected), String(recordsCollected)]);

      //console.log(`  💾 Updated last fetch info: ${now} (${recordsCollected} records)`);
    } catch (error) {
      // Non-critical - don't let this fail the collection
      console.warn('\x1b[31m   • Could not update last fetch info:', error.message,'\x1b[37m');
    }
  }

  /**
   * Get date range for fetching prices
   * @param {number} fetchDays - Number of historical days to fetch
   */
  getDateRange(fetchDays = 10) {
    const now = new Date();

    // Start: fetchDays ago at 00:00
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - fetchDays);
    startDate.setHours(0, 0, 0, 0);

    // End: day after tomorrow at 00:00 (to ensure we get all of tomorrow)
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 2);
    endDate.setHours(0, 0, 0, 0);

    return { startDate, endDate };
  }

  /**
   * Store prices in database
   */
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
          )
          VALUES (?, ?, ?, ?, ?, 'energy-charts')
          ON DUPLICATE KEY UPDATE
            price_eur_per_mwh = VALUES(price_eur_per_mwh),
            price_eur_per_kwh = VALUES(price_eur_per_kwh),
            updated_at = CURRENT_TIMESTAMP
        `, [
          datetimeStr,
          price.priceEurPerMWh,
          price.priceEurPerKWh,
          countryCode,
          biddingZone
        ]);

        recordsStored++;
      }

      //console.log(`  💾 Stored ${recordsStored} price records`);
      return recordsStored;

    } catch (error) {
      throw new Error(`Failed to store prices in database: ${error.message}`);
    }
  }

  /**
   * Get prices for specific date
   */
  async getPricesForDate(date, biddingZone = 'NL') {
    const [rows] = await db.pool.query(`
      SELECT 
        datetime,
        price_eur_per_kwh,
        price_eur_per_mwh,
        bidding_zone,
        country_code
      FROM day_ahead_prices
      WHERE DATE(datetime) = ?
        AND bidding_zone = ?
      ORDER BY datetime ASC
    `, [date, biddingZone]);

    return rows;
  }

  /**
   * Get cheapest and most expensive hours
   */
  async getExtremeHours(date, biddingZone = 'NL', topN = 3) {
    const [cheapest] = await db.pool.query(`
      SELECT datetime, price_eur_per_kwh, price_eur_per_mwh
      FROM day_ahead_prices
      WHERE DATE(datetime) = ?
        AND bidding_zone = ?
      ORDER BY price_eur_per_kwh ASC
      LIMIT ?
    `, [date, biddingZone, topN]);

    const [expensive] = await db.pool.query(`
      SELECT datetime, price_eur_per_kwh, price_eur_per_mwh
      FROM day_ahead_prices
      WHERE DATE(datetime) = ?
        AND bidding_zone = ?
      ORDER BY price_eur_per_kwh DESC
      LIMIT ?
    `, [date, biddingZone, topN]);

    return { cheapest, expensive };
  }

  /**
   * Get price summary for a date
   */
  async getPriceSummary(date, biddingZone = 'NL') {
    const [rows] = await db.pool.query(`
      SELECT 
        AVG(price_eur_per_kwh) as avg_price,
        MIN(price_eur_per_kwh) as min_price,
        MAX(price_eur_per_kwh) as max_price,
        STDDEV(price_eur_per_kwh) as price_std_dev,
        COUNT(*) as hours_count
      FROM day_ahead_prices
      WHERE DATE(datetime) = ?
        AND bidding_zone = ?
    `, [date, biddingZone]);

    return rows[0] || { 
      avg_price: null,
      min_price: null,
      max_price: null,
      price_std_dev: null,
      hours_count: 0
    };
  }

  /**
   * Get current hour price
   */
  async getCurrentPrice(biddingZone = 'NL') {
    const now = new Date();
    const currentHour = new Date(now);
    currentHour.setMinutes(0, 0, 0);

    const datetimeStr = currentHour.toISOString().slice(0, 19).replace('T', ' ');

    const [rows] = await db.pool.query(`
      SELECT 
        datetime,
        price_eur_per_kwh,
        price_eur_per_mwh
      FROM day_ahead_prices
      WHERE datetime = ?
        AND bidding_zone = ?
    `, [datetimeStr, biddingZone]);

    return rows[0] || null;
  }

  /**
   * Check if tomorrow's prices are available, setup retry if needed
   */
  async checkAndSetupRetryIfNeeded(biddingZone) {
    try {
      const now = new Date();
      const currentHour = now.getHours();

      if (currentHour < 14) {
        console.log('\x1b[93m   • Before 14:00 - tomorrow\'s prices may not be published yet/\x1b[37m');
        return;
      }

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowDate = tomorrow.toISOString().split('T')[0];

      const tomorrowPrices = await this.getPricesForDate(tomorrowDate, biddingZone);

      if (tomorrowPrices.length >= 24) {
        this.clearRetryTimer();
        console.log(`\x1b[33m   • Tomorrow's prices available (${tomorrowPrices.length} hours)/\x1b[37m`);
        this.retryCount = 0;
        return;
      }

      if (tomorrowPrices.length > 0) {
        console.log(`\x1b[31m   • Tomorrow's prices incomplete (${tomorrowPrices.length}/24 hours)/\x1b[37m`);
      } else {
        console.log(`\x1b[31m   • Tomorrow's prices not yet available/\x1b[37m`);
      }

      if (!this.retryTimer && this.retryCount < this.maxRetries) {
        this.setupHourlyRetry();
      } else if (this.retryCount >= this.maxRetries) {
        console.log(`\x1b[31m   • Max retries (${this.maxRetries}) reached - stopping retries/\x1b[37m`);
      }

    } catch (error) {
      console.error('\x1b[31m   • Error checking tomorrow\'s data:', error.message,'\x1b[37m');
    }
  }

  /**
   * Setup hourly retry timer
   */
  setupHourlyRetry() {
    this.clearRetryTimer();

    const retryInterval = 60 * 60 * 1000; // 1 hour
    const nextRetryTime = new Date(Date.now() + retryInterval);

    console.log(`\x1b[37m   • Day-Ahead-prices - Setting up hourly retry (attempt ${this.retryCount + 1}/${this.maxRetries})`);
    console.log(`\x1b[37m   • Day-Ahead-prices - Next retry at: ${nextRetryTime.toLocaleTimeString('nl-NL')}`);

    this.retryTimer = setTimeout(async () => {
      this.retryCount++;
      console.log(`\x1b[37m   • Day-Ahead-prices - Retry attempt ${this.retryCount}/${this.maxRetries} - Checking for tomorrow's prices...`);

      try {
        await this.collect();
      } catch (error) {
        console.error('Retry collection failed:', error.message);
      }
    }, retryInterval);
  }

  /**
   * Clear retry timer
   */
  clearRetryTimer() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /**
   * Get collector status (used by routes and status endpoint)
   */
  getStatus() {
    return {
      name: this.name,
      lastRun: this.lastRun,
      lastFetch: this.lastRun ? this.lastRun.toISOString() : null,
      lastFetchRecords: this.lastFetchRecords,
      lastError: this.lastError,
      healthy: this.lastError === null,
      retrying: this.retryTimer !== null,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries,
      apiInfo: api.getAPIInfo()
    };
  }

  /**
   * Test API connection
   */
  async testConnection() {
    console.log('`\x1b[37m   • Day-Ahead-prices - Testing Energy Charts API connection...');
    const health = await api.healthCheck();

    if (health.available) {
      console.log(`\x1b[37m   • Day-Ahead-prices - API is available`);
    } else {
      console.log(`\x1b[31m   • Day-Ahead-prices - API is unavailable:`, health.error,'\x1b[37m');
    }

    return health;
  }

  /**
   * Get supported bidding zones
   */
  getSupportedZones() {
    return api.getSupportedZones();
  }
}

export default new DayAheadPricesCollector();