// modules/solaredge-modbus/index.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import collector from './services/collector.js';
import routes from './routes/index.js';
import settingsService from '../../core/system/services/settingsService.js';
import capabilityRegistry from '../../core/capabilityRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8')
);

const MODULE_ID = 'solaredge-modbus';

class SolarEdgeModule {
  constructor() {
    this.manifest     = manifest;
    this.collector    = collector;
    this.routes       = routes;
    this.initialized  = false;
    this.config       = null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize() {
    if (this.initialized) return;

    try {
      console.log(`   - \x1b[93m${this.manifest.id} \x1b[37m`);

      this.config = await settingsService.getCategory(MODULE_ID);

      if (!this.config || this.config.enabled === false) {
        console.log(`     - Module disabled or not configured`);
        return;
      }

      if (!(this.config.host || this.config.ip_address) || !this.config.port) {
        console.warn(`     - Missing connection parameters (host/port)`);
        return;
      }

      console.log(`     - Host: ${this.config.host || this.config.ip_address}`);
      console.log(`     - Port: ${this.config.port}`);
      console.log(`     - Poll interval: ${this.config.poll_interval}ms`);

      this.initialized = true;

      // Register capabilities now that the module is confirmed live
      this._registerCapabilities();

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
      collector:   status,
    };
  }

  getRoutes() { return this.routes; }

  /**
   * Re-reads settings from DB and re-injects into collector.
   * Called by the core settings route after any setting change.
   */
  async reinitialize() {
    console.log(`   - ♻️  ${MODULE_ID}: reinitializing with fresh settings`);

    this.config = await settingsService.getCategory(MODULE_ID);
    collector.config = this.config;

    console.log(`   - ${MODULE_ID}: config reloaded`);
  }

  // ── Capability Registration ────────────────────────────────────────────────

  /**
   * Maps service types declared in manifest.json to collector handler functions.
   *
   * solar:read  — priority 10: SolarEdge is the authoritative solar source.
   *               Returns AC power, energy today/total, frequency, temperature.
   *
   * grid:read   — priority 6: SolarEdge measures grid power at the inverter level.
   *               Lower priority than a dedicated grid meter (HomeWizard P1 = 10).
   *               Useful as a fallback when no P1 meter is present.
   */
  _registerCapabilities() {
    // ── Solar read ─────────────────────────────────────────────────────────

    capabilityRegistry.register(
      'solar:read',
      async () => {
        const data = await this.collector.collect();
        return {
          // AC output power — what actually flows into the home/grid
          power:        data.ac_power        ?? data.power        ?? null,
          // DC input power from panels
          dc_power:     data.dc_power                             ?? null,
          // Energy counters
          energy_today: data.energy_today    ?? data.daily_energy ?? null,
          energy_total: data.energy_total    ?? data.total_energy ?? null,
          // System health
          frequency:    data.frequency                            ?? null,
          temperature:  data.temperature                         ?? null,
          // Operating status (0=Off, 1=Sleeping, 2=Starting, 3=MPPT, 4=Throttled, etc.)
          status:       data.status                               ?? null,
        };
      },
      10,       // SolarEdge is the authoritative solar source
      MODULE_ID
    );

    // ── Grid read ──────────────────────────────────────────────────────────
    // SolarEdge measures the grid connection point at the inverter.
    // Priority 6 — a dedicated P1 meter (priority 10) wins when available.

    capabilityRegistry.register(
      'grid:read',
      async () => {
        const data = await this.collector.collect();
        return {
          // Positive = export to grid, negative = import from grid
          // (SolarEdge SunSpec convention: positive = power flowing toward grid)
          total_active_power: data.grid_power   ?? data.total_active_power ?? null,
          l1_voltage:         data.l1_voltage   ?? data.voltage            ?? null,
          frequency:          data.frequency                               ?? null,
        };
      },
      6,        // Lower than P1 meter (10) — fallback grid source
      MODULE_ID
    );

    console.log(`     - Capabilities registered: solar:read (10), grid:read (6)`);
  }
}

export default new SolarEdgeModule();