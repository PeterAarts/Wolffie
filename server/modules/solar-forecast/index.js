// modules/solar-forecast/index.js
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
 * Solar Forecast Module
 * 
 * This module provides solar production forecasting using the Forecast.Solar API
 * Free API - No registration or API key required!
 */
class SolarForecastModule {
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
      console.log('   - Solar Forecast module already initialized');
      return;
    }

    try {
      console.log(`   - \x1b[93m${this.manifest.id} \x1b[37m`);
      this.config = await settingsService.getCategory(`${this.manifest.id}`);
      
      if (!this.config || this.config.enabled === false) {
        return; // Module disabled
      }
      
      // Validate required configuration
      if (!this.config.latitude || !this.config.longitude) {
        console.warn('     - Missing latitude/longitude configuration');
        return;
      }

      if (!this.config.kwp) {
        console.warn('     - Missing panel power (kWp) configuration');
        return;
      }
      
      console.log(`     - Location: ${this.config.latitude}°, ${this.config.longitude}°`);
      console.log(`     - Panel power: ${this.config.kwp} kWp`);
      console.log(`     - Tilt: ${this.config.tilt || 'N/A'}°, Azimuth: ${this.config.azimuth || 'N/A'}°`);
      console.log(`     - Fetch interval: ${this.config.fetch_interval_hours || 15}h`);
      
      this.initialized = true;
      console.log('     - Solar forecasting configured \x1b[32m✓\x1b[37m');
      
    } catch (error) {
      console.error('✗ Failed to initialize Solar Forecast module:', error.message);
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
    console.log('ℹ️  Solar Forecast module stopped');
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
      latitude: this.config?.latitude,
      longitude: this.config?.longitude,
      panelPower: this.config?.kwp,
      tilt: this.config?.tilt,
      azimuth: this.config?.azimuth,
      collector: {
        lastRun: collectorStatus.lastRun || null,
        lastError: collectorStatus.lastError || null,
        healthy: collectorStatus.healthy !== false
      }
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
export default new SolarForecastModule();