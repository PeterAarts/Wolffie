// modules/day-ahead-prices/index.js
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import collector from './services/collector.js';
import routes from './routes/index.js';
import settingsService from '../../core/system/services/settingsService.js';

// Get current directory for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load manifest.json
const manifestPath = join(__dirname, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

/**
 * Day-Ahead Electricity Prices Module
 * 
 * This module provides electricity price forecasting using the Energy Charts API
 * (Fraunhofer ISE) - No registration or API key required!
 */
class DayAheadPricesModule {
  constructor() {
    this.manifest = manifest;
    this.collector = collector;
    this.routes = routes;
    this.initialized = false;
    this.config = null;  // Store database configuration
  }

  /**
   * Initialize the module
   */
  async initialize() {
    if (this.initialized) {
      console.log('   - Day-Ahead Electricity Prices module already initialized');
      return;
    }

    try {
      console.log(`   - \x1b[93m${this.manifest.id} \x1b[37m`);
      this.config = await settingsService.getCategory(`${this.manifest.id}`);
      
      if (!this.config || this.config.enabled === false) return;
      
      // Validate required configuration
      if (!this.config.bidding_zone) {
        console.warn('     - Missing bidding zone configuration');
        return;
      }
      
      console.log(`     - Bidding zone: ${this.config.bidding_zone}`);
      console.log(`     - Country: ${this.config.country_code || 'N/A'}`);
      console.log(`     - Collection: 10 days history + today + tomorrow`);
      console.log(`     - Scheduled: Daily at 14:00 CET`);
      
      // Note: This is a scheduled collector, not interval-based
      // Collection happens via cron schedule defined in manifest
      
      this.initialized = true;
      console.log('     - Price fetching configured \x1b[32m✓\x1b[37m');
      
    } catch (error) {
      console.error('✗ Failed to initialize Day-Ahead Electricity Prices module:', error.message);
      throw error;
    }
  }

  /**
   * Start the module (called by module manager)
   */
  async start() {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Stop the module (called by module manager)
   */
  async stop() {
    console.log('⏹️  Day-Ahead Electricity Prices module stopped');
    this.initialized = false;
  }

  /**
   * Get module status
   */
  getStatus() {
    const collectorStatus = typeof this.collector.getStatus === 'function' 
      ? this.collector.getStatus() 
      : {};

    return {
      initialized: this.initialized,
      enabled: this.config?.enabled || false,
      hasConfig: !!this.config,
      biddingZone: this.config?.bidding_zone,
      countryCode: this.config?.country_code,
      collector: {
        lastRun: collectorStatus.lastRun || null,
        lastError: collectorStatus.lastError || null,
        healthy: collectorStatus.healthy !== false
      },
      apiInfo: collectorStatus.apiInfo
    };
  }

  /**
   * Collect data (called by CollectorManager)
   */
  async collect() {
    return await this.collector.collect();
  }

  /**
   * Get API routes
   */
  getRoutes() {
    return this.routes;
  }
}

// Export a singleton instance
export default new DayAheadPricesModule();