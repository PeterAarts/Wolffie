// modules/alphaess-modbus-tcp/index.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import settingsService from '../../core/system/services/settingsService.js';
import api from './services/api.js';
import collector from './services/collector.js';
import capabilityRegistry from '../../core/capabilityRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const manifestPath = path.join(__dirname, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const MODULE_ID = 'alphaess-modbus-tcp';
const PRIORITY  = 10;

class AlphaESSModbusTCPModule {
  constructor() {
    this.manifest    = manifest;
    this.initialized = false;
    this.connected   = false;
    this.config      = null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize() {
    if (this.initialized) return;
    try {
      console.log(`   - \x1b[93m${this.manifest.id} \x1b[37m`);
      this.config = await settingsService.getCategory(MODULE_ID);

      if (!this.config || this.config.enabled === false) return;

      console.log(`     - ModBus IP: ${this.config.host}:${this.config.port}`);

      // Safety check using the API's TCP probe
      const isAlive = await api.checkStatus(this.config.host, this.config.port);

      if (isAlive) {
        this.connected = true;
        console.log('\x1b[37m     - ModBus connection established \x1b[32m✓\x1b[37m');

        // Safety reset — ensures the inverter is in Self-Consumption mode
        // after any crash that may have left a dispatch command running.
        await api.connect(this.config.host, this.config.port, this.config.unit_id);
        await api.resetOnStartup();
      } else {
        this.connected = false;
        console.warn('\x1b[91m     - ModBus connection failed (Port unreachable)\x1b[37m');
      }

      // Pre-load routes so routeManager can find them as module.routes
      this.routes = await this.getRoutes();

      // Inject config into collector so it can connect without re-fetching settings
      collector.config = this.config;

      this.initialized = true;

      // Register capabilities — only if actually connected
      if (this.connected) {
        this._registerCapabilities();
      }

    } catch (error) {
      console.error('\x1b[91m     - Failed to initialize module:', error.message);
      throw error;
    }
  }

  async collect() {
    return await collector.collect();
  }

  getStatus() {
    return {
      ...collector.getStatus(),
      connected: this.connected,
    };
  }

  async getRoutes() {
    try {
      const routesPath = path.join(__dirname, 'routes', 'index.js');
      if (fs.existsSync(routesPath)) {
        const routeModule = await import(pathToFileURL(routesPath).href);
        return routeModule.default;
      }
    } catch (error) {
      console.error(`[${MODULE_ID}] Route loading error:`, error.message);
    }
    return null;
  }

  async reinitialize() {
    console.log(`   - ♻️  ${MODULE_ID}: reinitializing with fresh settings`);

    this.config = await settingsService.getCategory(MODULE_ID);

    // Re-inject into collector so next collect() uses the new values
    collector.config = this.config;

    // Re-check connection with potentially new host/port
    const isAlive = await api.checkStatus(this.config.host, this.config.port);
    this.connected = isAlive;

    console.log(`   - ${MODULE_ID}: connection ${isAlive ? '✓' : '✗'} (${this.config.host}:${this.config.port})`);

    // Re-register capabilities if now connected, unregister if not
    if (isAlive) {
      this._registerCapabilities();
    } else {
      capabilityRegistry.unregister(MODULE_ID);
    }
  }

  // ── Capability Registration ────────────────────────────────────────────────

  _registerCapabilities() {

    // ── Battery reads ──────────────────────────────────────────────────────

    capabilityRegistry.register(
      'battery:read',
      async () => {
        const d = await api.fetchAll();
        return d.battery;
      },
      PRIORITY,
      MODULE_ID
    );

    capabilityRegistry.register(
      'battery:status',
      () => api.getDispatchStatus(),
      PRIORITY,
      MODULE_ID
    );

    // ── Battery control ────────────────────────────────────────────────────

    capabilityRegistry.register(
      'battery:charge-from-grid',
      async (body) => {
        const { watts, targetSOC, durationHours } = body;
        await api.startCharge(watts, targetSOC, durationHours);
        return { success: true, command: { mode: 'charge-from-grid', watts, targetSOC, durationHours } };
      },
      PRIORITY,
      MODULE_ID
    );

    capabilityRegistry.register(
      'battery:discharge-to-grid',
      async (body) => {
        const { watts, minimumSOC, durationHours } = body;
        await api.startDischarge(watts, minimumSOC, durationHours);
        return { success: true, command: { mode: 'discharge-to-grid', watts, minimumSOC, durationHours } };
      },
      PRIORITY,
      MODULE_ID
    );

    capabilityRegistry.register(
      'battery:stop',
      async () => {
        await api.stopDispatch();
        return { success: true, mode: 'Self-Consumption' };
      },
      PRIORITY,
      MODULE_ID
    );

    // ── Solar reads ────────────────────────────────────────────────────────

    capabilityRegistry.register(
      'solar:read',
      async () => {
        const d = await api.fetchAll();
        return d.solar;
      },
      PRIORITY,
      MODULE_ID
    );

    // ── Grid reads ─────────────────────────────────────────────────────────

    capabilityRegistry.register(
      'grid:read',
      async () => {
        const d = await api.fetchAll();
        return d.grid;
      },
      PRIORITY,
      MODULE_ID
    );

    // ── Home load (derived) ────────────────────────────────────────────────
    // Priority 5 — a P1 meter module registers home:read at priority 10
    // and automatically takes over when available.

    capabilityRegistry.register(
      'home:read',
      async () => {
        const d = await api.fetchAll();
        return d.home;
      },
      5,
      MODULE_ID
    );

    console.log(`     - Capabilities registered`);
  }
}

export default new AlphaESSModbusTCPModule();