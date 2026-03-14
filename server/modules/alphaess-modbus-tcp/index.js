// modules/alphaess-modbus-tcp/index.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import settingsService from '../../core/system/services/settingsService.js';
import api from './services/api.js'; 
import collector from './services/collector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const manifestPath = path.join(__dirname, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

class AlphaESSModbusTCPModule {
  constructor() {
    this.manifest = manifest;
    this.initialized = false;
    this.connected = false;
    this.config = null;
  }

  /**
   * Initialize the module
   */
  async initialize() {
    if (this.initialized) return;
    try {
      console.log(`   - \x1b[93m${this.manifest.id} \x1b[37m`);
      this.config = await settingsService.getCategory(`${this.manifest.id}`);
      
      if (!this.config || this.config.enabled === false) return;
      
      console.log(`     - ModBus IP: ${this.config.host}:${this.config.port}`);
      
      // Safety check using the API's TCP probe
      const isAlive = await api.checkStatus(this.config.host, this.config.port);
      
      if (isAlive) {
        this.connected = true;
        console.log('\x1b[37m     - ModBus connection established \x1b[32m✓\x1b[37m');
      } else {
        this.connected = false;
        console.warn('\x1b[91m     - ModBus connection failed (Port unreachable)\x1b[37m');
      }

      // Pre-load routes so routeManager can find them as module.routes
      this.routes = await this.getRoutes();

      // Inject config into collector so it can connect without re-fetching settings
      collector.config = this.config;

      this.initialized = true;
    } catch (error) {
      console.error('\x1b[91m     - Failed to initialize module:', error.message);
      throw error;
    }
  }

  async collect() {
    return await collector.collect();
  }

  getStatus() {
    const collectorStatus = collector.getStatus();
    return {
      ...collectorStatus,
      connected: this.connected
    };
  }

  /**
   * Fixed: Explicitly await and return the router default export to resolve the loading error.
   */
  async getRoutes() {
    try {
      const routesPath = path.join(__dirname, 'routes', 'index.js');
      if (fs.existsSync(routesPath)) {
        const routeModule = await import(pathToFileURL(routesPath).href);
        return routeModule.default;
      }
    } catch (error) {
      console.error(`[${this.manifest.id}] Route loading error:`, error.message);
    }
    return null;
  }
  /**
   * Re-reads settings from DB and re-injects into collector.
   * Called by the core settings route after any setting change.
   */
  async reinitialize() {
    console.log(`   - ♻️  ${this.manifest.id}: reinitializing with fresh settings`);

    this.config = await settingsService.getCategory(this.manifest.id);

    // Re-inject into collector so next collect() uses the new values
    collector.config = this.config;

    // Re-check connection with potentially new host/port
    const isAlive = await api.checkStatus(this.config.host, this.config.port);
    this.connected = isAlive;

    console.log(`   - ${this.manifest.id}: connection ${isAlive ? '✓' : '✗'} (${this.config.host}:${this.config.port})`);
  }
}

export default new AlphaESSModbusTCPModule();