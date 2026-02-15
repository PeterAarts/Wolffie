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
    this.retryTimer = null;  // Timer for hourly retries
    this.retryCount = 0;     // Count of retry attempts
    this.maxRetries = 10;    // Max retries (stop after 10 hours)
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
        console.log('  🆕 New day detected - resetting retry counter');
        this.retryCount = 0;
        this.clearRetryTimer();
      }

      console.log('💰 Day-Ahead Prices: Starting collection...');

      // Load settings from database (same as other modules)
      const settings = await settingsService.getCategory('day-ahead-prices');

      if (!settings || settings.enabled === false) {
        console.log('⏭️  Day-Ahead Prices: Disabled in settings');
        return false; // Return false instead of object to match collector pattern
      }

      // Validate required settings
      const { bidding_zone, country_code } = settings;

      if (!bidding_zone) {
        this.lastError = 'Missing bidding_zone in settings';
        console.error('✗ Day-Ahead Prices: Missing bidding_zone');
        return false;
      }

      // Determine date range (10 days ago + today + tomorrow)
      const { startDate, endDate } = this.getDateRange();

      console.log(`  📅 Fetching prices from ${api.formatDateForAPI(startDate)} to ${api.formatDateForAPI(endDate)}`);
      console.log(`  📊 Date range: 10 days history + today + tomorrow`);
      console.log(`  🌍 Bidding zone: ${bidding_zone} (${country_code || 'N/A'})`);

      // Fetch prices from Energy Charts API (no token needed!)
      const prices = await api.getDayAheadPrices(
        bidding_zone,
        startDate,
        endDate
      );

      // Store prices in database
      recordsCollected = await this.storePrices(prices, country_code || bidding_zone, bidding_zone);

      this.lastRun = new Date();

      console.log(`✅ Day-Ahead Prices: Collected ${recordsCollected} price points`);

      // Check if we got tomorrow's data (important for optimization)
      await this.checkAndSetupRetryIfNeeded(bidding_zone);

      return true; // Return true for success to match collector pattern

    } catch (error) {
      this.lastError = error.message;
      console.error('✗ Day-Ahead Prices Error:', error.message);
      return false; // Return false for failure
    }
  }

  /**
   * Get date range for fetching prices
   * Returns 10 days ago 00:00 to day after tomorrow 00:00
   */
  getDateRange() {
    const now = new Date();
    
    // Start: 10 days ago at 00:00
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 10);
    startDate.setHours(0, 0, 0, 0);

    // End: day after tomorrow at 00:00 (to ensure we get all of tomorrow)
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 2);
    endDate.setHours(0, 0, 0, 0);

    return { startDate, endDate };
  }

  /**
   * Store prices in database
   * @param {array} prices - Normalized price data from API
   * @param {string} countryCode - Country code
   * @param {string} biddingZone - Bidding zone
   */
  async storePrices(prices, countryCode, biddingZone) {
    if (!prices || prices.length === 0) {
      throw new Error('No price data received from API');
    }

    let recordsStored = 0;

    try {
      for (const price of prices) {
        // Format datetime for MySQL
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

      console.log(`  💾 Stored ${recordsStored} price records`);
      return recordsStored;

    } catch (error) {
      throw new Error(`Failed to store prices in database: ${error.message}`);
    }
  }

  /**
   * Get prices for specific date
   * @param {string} date - Date in YYYY-MM-DD format
   * @param {string} biddingZone - Bidding zone code
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
   * @param {string} date - Date in YYYY-MM-DD format
   * @param {string} biddingZone - Bidding zone code
   * @param {number} topN - Number of hours to return
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
   * @param {string} date - Date in YYYY-MM-DD format
   * @param {string} biddingZone - Bidding zone code
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
   * @param {string} biddingZone - Bidding zone code
   */
  async getCurrentPrice(biddingZone = 'NL') {
    const now = new Date();
    const currentHour = new Date(now);
    currentHour.setMinutes(0, 0, 0, 0);
    
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
   * Only retries if:
   * - Current time is after 14:00
   * - Tomorrow's data is missing
   * - We haven't exceeded max retries
   */
  async checkAndSetupRetryIfNeeded(biddingZone) {
    try {
      const now = new Date();
      const currentHour = now.getHours();
      
      // Only set up retries if it's after 14:00 (when prices should be published)
      if (currentHour < 14) {
        console.log('  ℹ️  Before 14:00 - tomorrow\'s prices may not be published yet');
        return;
      }

      // Check if tomorrow's prices exist in database
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowDate = tomorrow.toISOString().split('T')[0];
      
      const tomorrowPrices = await this.getPricesForDate(tomorrowDate, biddingZone);
      
      if (tomorrowPrices.length >= 24) {
        // We have tomorrow's full data - clear any existing retry timer
        this.clearRetryTimer();
        console.log(`  ✅ Tomorrow's prices available (${tomorrowPrices.length} hours)`);
        this.retryCount = 0;
        return;
      }

      // Tomorrow's data is missing or incomplete
      if (tomorrowPrices.length > 0) {
        console.log(`  ⚠️  Tomorrow's prices incomplete (${tomorrowPrices.length}/24 hours)`);
      } else {
        console.log(`  ⚠️  Tomorrow's prices not yet available`);
      }

      // Set up hourly retry if not already running and within retry limit
      if (!this.retryTimer && this.retryCount < this.maxRetries) {
        this.setupHourlyRetry();
      } else if (this.retryCount >= this.maxRetries) {
        console.log(`  ⏸️  Max retries (${this.maxRetries}) reached - stopping retries`);
      }

    } catch (error) {
      console.error('  ✗ Error checking tomorrow\'s data:', error.message);
    }
  }

  /**
   * Setup hourly retry timer
   */
  setupHourlyRetry() {
    // Clear any existing timer
    this.clearRetryTimer();

    const retryInterval = 60 * 60 * 1000; // 1 hour in milliseconds
    const nextRetryTime = new Date(Date.now() + retryInterval);
    
    console.log(`  🔄 Setting up hourly retry (attempt ${this.retryCount + 1}/${this.maxRetries})`);
    console.log(`  ⏰ Next retry at: ${nextRetryTime.toLocaleTimeString('nl-NL')}`);

    this.retryTimer = setTimeout(async () => {
      this.retryCount++;
      console.log(`\n🔄 Retry attempt ${this.retryCount}/${this.maxRetries} - Checking for tomorrow's prices...`);
      
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
      console.log('  ✓ Cleared retry timer');
    }
  }

  /**
   * Get collector status
   */
  getStatus() {
    return {
      name: this.name,
      lastRun: this.lastRun,
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
    console.log('🔍 Testing Energy Charts API connection...');
    const health = await api.healthCheck();
    
    if (health.available) {
      console.log('✅ API is available');
    } else {
      console.log('❌ API is unavailable:', health.error);
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