import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import collector from './services/collector.js';
import routes from './routes/index.js';
import settingsService from '../../core/system/services/settingsService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));

class SolarEdgeModule {
  constructor() {
    this.manifest = manifest;
    this.collector = collector;
    this.routes = routes;
    this.initialized = false;
    this.config = null;  // Store database configuration
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      console.log(`   - \x1b[93m${this.manifest.id} \x1b[37m`);
      
      // Load configuration from database (same as collector does)
      this.config = await settingsService.getCategory(`${this.manifest.id}`);
      
      if (!this.config || this.config.enabled === false) {
        console.log(`     - Module disabled or not configured`);
        return; // Don't set initialized = true if disabled
      }
      // Validate required configuration
      if (!(this.config.host || this.config.ip_address) || !this.config.port) {
        console.warn(`     -  Missing connection parameters (host/port)`);
        return;
      }
      
      // Log configuration (without sensitive data)
      console.log(`     - Host: ${this.config.host || this.config.ip_address}`);
      console.log(`     - Port: ${this.config.port}`);
      console.log(`     - Poll interval: ${this.config.poll_interval}ms`);
      
      this.initialized = true;
      
    } catch (error) {
      console.error(`     ✗ ${this.manifest.name} Init Failed:`, error.message);
    }
  }

  async collect() {
    return await this.collector.collect();
  }

  getStatus() {
    const status = this.collector.getStatus?.() || {};
    return {
      initialized: this.initialized,
      collector: status
    };
  }

  getRoutes() { return this.routes; }
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

export default new SolarEdgeModule();