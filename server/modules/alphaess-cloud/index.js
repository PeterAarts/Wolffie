// modules/alphaess-cloud/index.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import collector from './services/collector.js';
import alphaessAPI from './services/api.js';
import settingsService from '../../core/system/services/settingsService.js';
import capabilityRegistry from '../../core/capabilityRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load manifest
const manifestPath = path.join(__dirname, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const MODULE_ID = 'alphaess-cloud';
const PRIORITY  = 10; // Lower than alphaess-modbus-tcp (15) — modbus wins when available

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

      // Register capabilities — always register for cloud (no physical connection to check)
      // Modbus-TCP registers at priority 15 and will override these when connected
      this._registerCapabilities();

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
  async reinitialize() {
    console.log(`   - ♻️  ${MODULE_ID}: reinitializing with fresh settings`);
    this.config = await settingsService.getCategory(MODULE_ID);
    collector.config = this.config;

    if (this.config?.app_id && this.config?.app_secret && this.config?.system_sn) {
      this._registerCapabilities();
    } else {
      capabilityRegistry.unregister(MODULE_ID);
    }
  }

  // ── Capability Registration ────────────────────────────────────────────────

  _registerCapabilities() {

    // ── Battery read ───────────────────────────────────────────────────────
    capabilityRegistry.register(
      'battery:read',
      async () => {
        const data = await alphaessAPI.getLastPowerData();
        return {
          soc:   data.soc   ?? data.cbat ?? 0,
          power: data.pbat  ?? 0,
        };
      },
      PRIORITY,
      MODULE_ID
    );

    // ── Solar read ─────────────────────────────────────────────────────────
    capabilityRegistry.register(
      'solar:read',
      async () => {
        const data = await alphaessAPI.getLastPowerData();
        return {
          total_power: data.ppv  ?? 0,
          pv1:         data.ppv1 ?? 0,
          pv2:         data.ppv2 ?? 0,
          pv3:         data.ppv3 ?? 0,
        };
      },
      PRIORITY,
      MODULE_ID
    );

    // ── Grid read ──────────────────────────────────────────────────────────
    capabilityRegistry.register(
      'grid:read',
      async () => {
        const data = await alphaessAPI.getLastPowerData();
        return {
          power: data.pgrid ?? 0,
        };
      },
      PRIORITY,
      MODULE_ID
    );

    // ── Home read ──────────────────────────────────────────────────────────
    capabilityRegistry.register(
      'home:read',
      async () => {
        const data = await alphaessAPI.getLastPowerData();
        return {
          power: data.pload ?? 0,
        };
      },
      PRIORITY,
      MODULE_ID
    );

    // ── Battery control ────────────────────────────────────────────────────
    // Note: cloud API does not support direct dispatch commands.
    // These are registered as stubs so the strategy manager doesn't error —
    // actual dispatch requires alphaess-modbus-tcp at higher priority.
    capabilityRegistry.register(
      'battery:charge-from-grid',
      async () => {
        throw new Error('battery:charge-from-grid requires alphaess-modbus-tcp (not available via cloud API)');
      },
      PRIORITY,
      MODULE_ID
    );

    capabilityRegistry.register(
      'battery:discharge-to-grid',
      async () => {
        throw new Error('battery:discharge-to-grid requires alphaess-modbus-tcp (not available via cloud API)');
      },
      PRIORITY,
      MODULE_ID
    );

    capabilityRegistry.register(
      'battery:stop',
      async () => {
        throw new Error('battery:stop requires alphaess-modbus-tcp (not available via cloud API)');
      },
      PRIORITY,
      MODULE_ID
    );

    console.log(`     - Capabilities registered (priority ${PRIORITY} — modbus-tcp overrides at 15)`);
  }
}


// Export singleton instance
export default new AlphaESSCloudModule();