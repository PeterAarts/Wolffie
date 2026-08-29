// modules/homewizard/index.js
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import collector from './services/collector.js';
import routes from './routes/index.js';
import settingsService from '../../core/system/services/settingsService.js';
import capabilityRegistry from '../../core/capabilityRegistry.js';
import { padName } from '../../core/utils/logger.js';
const PREFIX = padName('HomeWizard');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const manifestPath = join(__dirname, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

const MODULE_ID = 'homewizard';
const PRIORITY  = 15; // Highest — P1 meter is most accurate grid source

class HomeWizardModule {
  constructor() {
    this.manifest = manifest;
    this.collector = collector;
    this.routes = routes;
    this.initialized = false;
    this.config = null;
  }

  async initialize() {
    if (this.initialized) {
      console.log(`   - ${PREFIX} module already initialized`);
      return;
    }

    try {
      console.log(`   - \x1b[93m${PREFIX} \x1b[37m`);

      this.config = await settingsService.getCategory(MODULE_ID);

      if (!this.config || this.config.enabled === false) {
        return;
      }

      console.log(`     - Auto discovery: ${this.config.auto_discover !== false ? 'enabled' : 'disabled'}`);
      console.log(`     - Poll interval: ${this.config.poll_interval || 10000}ms`);

      this.initialized = true;
      console.log(`     - ${PREFIX} service ready \x1b[32m✓\x1b[37m`);

      // Register capabilities — handler resolves device at call time
      this._registerCapabilities();

    } catch (error) {
      console.log(`     - ${PREFIX}: Failed to initialize module:`, error.message);
      throw error;
    }
  }

  async start() {
    if (!this.initialized) await this.initialize();
  }

  async stop() {
    console.log(`     - ${PREFIX}: module stopped`);
    this.initialized = false;
  }

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
        deviceCount:       collectorStatus.deviceCount || 0,
        lastRun:           collectorStatus.lastCollection || null,
        lastError:         collectorStatus.lastError || null,
        consecutiveErrors: collectorStatus.consecutiveErrors || 0,
        healthy:           (collectorStatus.consecutiveErrors || 0) < 5
      }
    };
  }

  async collect() {
    return await this.collector.collect();
  }

  getRoutes() {
    return this.routes;
  }

  async reinitialize() {
    console.log(`   - ${PREFIX}: reinitializing with fresh settings`);
    this.config = await settingsService.getCategory(MODULE_ID);
    collector.config = this.config;
    await collector.reloadDevices();
    console.log(`   - ${PREFIX}: reinitialized`);
  }

  // ── Capability Registration ─────────────────────────────────────────────────

  _registerCapabilities() {

    // ── grid:read via P1 meter cache ─────────────────────────────────────────
    //
    // Reads from the collector's in-memory cache (refreshed every collection
    // cycle). No live HTTP calls — fast, non-blocking, at most one cycle old.
    //
    // The P1 meter sits at the utility grid connection point and measures
    // official grid import/export. Sign convention: positive = importing.

    capabilityRegistry.register(
      'grid:read',
      async () => {
        const d = collector.getLastP1Reading();
        if (!d) throw new Error('No P1 data available yet — collector has not run');

        return {
          power:        d.power,
          power_l1:     d.power_l1,
          power_l2:     d.power_l2,
          power_l3:     d.power_l3,
          voltage_l1:   d.voltage_l1,
          voltage_l2:   d.voltage_l2,
          voltage_l3:   d.voltage_l3,
          current_l1:   d.current_l1,
          current_l2:   d.current_l2,
          current_l3:   d.current_l3,
          frequency:    d.frequency,
          import_today: d.import_today,
          export_today: d.export_today,
        };
      },
      PRIORITY,
      MODULE_ID
    );

    console.log(`     - Capabilities registered (grid:read @ priority ${PRIORITY})`);
  }
}

export default new HomeWizardModule();