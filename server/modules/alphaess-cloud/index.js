// modules/alphaess-cloud/index.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import collector from './services/collector.js';
import alphaessAPI from './services/api.js';
import settingsService from '../../core/system/services/settingsService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load manifest
const manifestPath = path.join(__dirname, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

/**
 * AlphaESS Cloud Module
 * 
 * This module provides AlphaESS Cloud API integration for remote monitoring
 * and data collection from the AlphaESS cloud platform.
 */
class AlphaESSCloudModule {
  constructor() {
    this.manifest = manifest;
    this.collector = collector;
    this.api = alphaessAPI;
    this.initialized = false;
    this.config = null;
  }

  /**
   * Initialize the module
   */
  async initialize() {
    if (this.initialized) {
      console.log('   - AlphaESS Cloud module already initialized');
      return;
    }
    try {
      console.log(`   - \x1b[93m${this.manifest.id} \x1b[37m`);
      this.config = await settingsService.getCategory(`${this.manifest.id}`);
      if (!this.config || this.config.enabled === false) return;
      if (!this.config.app_id || !this.config.app_secret || !this.config.system_sn) {
        console.warn('Missing credentials');
        return;
      }
      console.log(`     - System SN: ${this.config.system_sn}`);
      console.log(`     - Poll interval: ${this.config.poll_interval}ms`);

      // Test API connection
      const health = await this.api.healthCheck();
      
      if (health.available) {
        console.log('     - API is available and authenticated \x1b[32m✓\x1b[37m');
      } else {
        console.warn('     - AlphaESS Cloud API not available: \x1b[31m', health.lastError,'\x1b[37m');
      }

      this.initialized = true;
      //console.log('✅ AlphaESS Cloud module initialized');
    } catch (error) {
      console.error('❌ Failed to initialize AlphaESS Cloud module:', error.message);
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
    //console.log('▶️  AlphaESS Cloud module started');
  }

  /**
   * Stop the module (called by module manager)
   */
  async stop() {
    console.log('⏹️  AlphaESS Cloud module stopped');
  }

  /**
   * Get module status
   */
  getStatus() {
    const collectorStatus = this.collector.getStatus();
    const apiStats = this.api.getStats();

    return {
      initialized: this.initialized,
      enabled: this.config?.enabled || false,
      hasConfig: !!this.config,
      pollInterval: this.config?.poll_interval,
      collector: {
        lastCollection: collectorStatus.lastCollection,
        lastError: collectorStatus.lastError,
        consecutiveErrors: collectorStatus.consecutiveErrors,
        healthy: collectorStatus.consecutiveErrors < 3
      },
      api: {
        available: this.api.isAvailable(),
        requestCount: apiStats.requestCount,
        lastRequestTime: apiStats.lastRequestTime,
        lastError: apiStats.lastError
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
   * Get API routes (if this module provides HTTP endpoints)
   */
  getRoutes() {
    // Import routes dynamically if they exist
    try {
      const routesPath = path.join(__dirname, 'routes', 'index.js');
      if (fs.existsSync(routesPath)) {
        return import('./routes/index.js');
      }
    } catch (error) {
      console.warn('No routes found for AlphaESS Cloud module');
    }
    return null;
  }
}

// Export singleton instance
export default new AlphaESSCloudModule();