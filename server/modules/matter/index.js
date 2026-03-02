// modules/matter/index.js
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import collector from './services/collector.js';
import routes from './routes/index.js';
import matterAPI from './services/api.js';
import settingsService from '../../core/system/services/settingsService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const manifestPath = join(__dirname, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

/**
 * Matter Module
 * Manages the Matter Controller lifecycle and local device communication
 */
class MatterModule {
  constructor() {
    this.manifest = manifest;
    this.collector = collector;
    this.routes = routes;
    this.initialized = false;
    this.config = null;
  }

  /**
   * Initialize the module and the Matter Controller
   */
  async initialize() {
    if (this.initialized) return;

    try {
      console.log(`   - \x1b[93m${this.manifest.id} \x1b[37m`);
      
      // Load module-level configuration
      this.config = await settingsService.getCategory(this.manifest.id);
      
      if (!this.config || this.config.enabled === false) {
        return; // Module disabled
      }

      // Initialize the Matter Stack (Controller/Fabric)
      await matterAPI.initialize();
      
      this.initialized = true;
      console.log('     - Matter service ready and controller started \x1b[32m✓\x1b[37m');
      
    } catch (error) {
      console.error('✗ Failed to initialize Matter module:', error.message);
      throw error;
    }
  }
  /**
   * This is the method the WattsOn RouteManager calls to mount the API
   */

  async start() {
    if (!this.initialized) await this.initialize();
  }

  async stop() {
    console.log('⏹️  Matter module stopping...');
    await matterAPI.stop();
    this.initialized = false;
  }

  getStatus() {
    const collectorStatus = typeof this.collector.getStatus === 'function' 
      ? this.collector.getStatus() 
      : {};

    return {
      initialized: this.initialized,
      enabled: this.config?.enabled || false,
      collector: {
        deviceCount: collectorStatus.deviceCount || 0,
        lastRun: collectorStatus.lastCollection || null,
        healthy: (collectorStatus.consecutiveErrors || 0) < 5
      }
    };
  }

  async collect() {
    if (!this.initialized) return false;
    return await this.collector.collect();
  }
  getRoutes() {
    return this.routes;
  }
}

export default new MatterModule();