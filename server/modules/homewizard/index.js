// modules/homewizard/index.js
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
 * HomeWizard Energy Module
 * Follows the standard class-based pattern for WattsOn modules
 */
class HomeWizardModule {
  constructor() {
    this.manifest = manifest;
    this.collector = collector;
    this.routes = routes;
    this.initialized = false;
    this.config = null;  // Store database configuration
  }

  /**
   * Initialize the module (called during system startup)
   */
  async initialize() {
    if (this.initialized) {
      console.log('   - HomeWizard Energy module already initialized');
      return;
    }

    try {
      console.log(`   - \x1b[93m${this.manifest.id} \x1b[37m`);
      
      // Load configuration from database
      this.config = await settingsService.getCategory(`${this.manifest.id}`);
      
      if (!this.config || this.config.enabled === false) {
        return; // Module disabled
      }
      
      // Log configuration
      console.log(`     - Auto discovery: ${this.config.auto_discover !== false ? 'enabled' : 'disabled'}`);
      console.log(`     - Poll interval: ${this.config.poll_interval || 10000}ms`);
      
      // Note: Device discovery happens in the collector
      
      this.initialized = true;
      console.log('     - HomeWizard service ready \x1b[32m✓\x1b[37m');
      
    } catch (error) {
      console.error('✗ Failed to initialize HomeWizard Energy module:', error.message);
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
    console.log('⏹️  HomeWizard Energy module stopped');
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
      pollInterval: this.config?.poll_interval,
      autoDiscover: this.config?.auto_discover,
      collector: {
        deviceCount: collectorStatus.deviceCount || 0,
        lastRun: collectorStatus.lastCollection || null,
        lastError: collectorStatus.lastError || null,
        consecutiveErrors: collectorStatus.consecutiveErrors || 0,
        healthy: (collectorStatus.consecutiveErrors || 0) < 5
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
export default new HomeWizardModule();