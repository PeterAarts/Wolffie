// modules/homewizard/index.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import collector from './services/collector.js';
import homewizardAPI from './services/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load manifest
const manifestPath = path.join(__dirname, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

/**
 * HomeWizard Module
 * 
 * This module provides HomeWizard local API integration for monitoring
 * P1 meters, energy sockets, and kWh meters on the local network.
 */
class HomeWizardModule {
  constructor() {
    this.manifest = manifest;
    this.collector = collector;
    this.api = homewizardAPI;
    this.initialized = false;
  }

  /**
   * Initialize the module
   */
  async initialize() {
    if (this.initialized) {
      console.log('⚠️  HomeWizard module already initialized');
      return;
    }

    console.log('🔌 Initializing HomeWizard module...');

    try {
      // HomeWizard devices are discovered and tested individually
      // No global API health check needed
      console.log('✅ HomeWizard API service ready');

      this.initialized = true;
      console.log('✅ HomeWizard module initialized');
    } catch (error) {
      console.error('❌ Failed to initialize HomeWizard module:', error.message);
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
    console.log('▶️  HomeWizard module started');
  }

  /**
   * Stop the module (called by module manager)
   */
  async stop() {
    console.log('⏹️  HomeWizard module stopped');
  }

  /**
   * Get module status
   */
  getStatus() {
    const collectorStatus = this.collector.getStatus();

    return {
      initialized: this.initialized,
      collector: {
        deviceCount: collectorStatus.deviceCount,
        lastCollection: collectorStatus.lastCollection,
        lastError: collectorStatus.lastError,
        consecutiveErrors: collectorStatus.consecutiveErrors,
        healthy: collectorStatus.consecutiveErrors < 3
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
      console.warn('No routes found for HomeWizard module');
    }
    return null;
  }
}

// Export singleton instance
export default new HomeWizardModule();