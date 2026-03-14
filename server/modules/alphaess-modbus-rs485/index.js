import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import collector from './services/collector.js';
import routes from './routes/index.js';
import settingsService from '../../core/system/services/settingsService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));

class AlphaESSModbus485 {
  constructor() {
    this.manifest = manifest;
    this.collector = collector;
    this.routes = routes;
    this.initialized = false;
    this.config = null;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      console.log(`   - \x1b[93m${this.manifest.id} \x1b[37m`);
      this.config = await settingsService.getCategory(`${this.manifest.id}`);
      if (!this.config || this.config.enabled === false) return;
      if (!this.config.port) {
        console.warn('Missing serial port');
        return;
      }
      console.log(`   - Serial Port: ${this.config.port}`);
      console.log(`   - Slave ID: ${this.config.slave_id || 85}`);
      console.log(`   - Poll interval: ${this.config.poll_interval}ms`);
      console.log(`   - Initializing ${this.manifest.name}...`);
      // Add Modbus connection test here
      this.initialized = true;
    } catch (error) {
      console.error(`❌ ${this.manifest.name} Init Failed:`, error.message);
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
  getRoutes() { return this.routes; }
}

export default new AlphaESSModbus485();