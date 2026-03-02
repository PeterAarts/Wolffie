// modules/alphaess-modbus-tcp/index.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import settingsService from '../../core/system/services/settingsService.js';
import api from './services/api.js'; // Importeer de gedeelde API service
import collector from './services/collector.js';
import routes from './routes/index.js';

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
      console.log(`     - Slave ID: ${this.config.unit_id || 85}`);

      // ✅ HERSTEL VAN DE CHECK: Gebruik de veilige TCP-probe
      const isAlive = await api.checkStatus(this.config.host, this.config.port);
      
      if (isAlive) {
        this.connected = true;
        console.log('\x1b[37m     - ModBus connection established \x1b[32m✓\x1b[37m');
      } else {
        this.connected = false;
        console.warn('\x1b[91m     - ModBus connection failed (Port 502 unreachable)\x1b[37m');
      }

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

  getRoutes() {
    return routes;
  }
}

export default new AlphaESSModbusTCPModule();