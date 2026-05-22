// modules/solaredge-modbus/index.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import api from './services/api.js';
import collector from './services/collector.js';
import routes from './routes/index.js';
import settingsService from '../../core/system/services/settingsService.js';
import capabilityRegistry from '../../core/capabilityRegistry.js';
import { padName } from '../../core/utils/logger.js';
const PREFIX = padName('SolarEdge ModBus');
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8')
);

const MODULE_ID = 'solaredge-modbus';

class SolarEdgeModule {
  constructor() {
    this.manifest    = manifest;
    this.collector   = collector;
    this.routes      = routes;
    this.initialized = false;
    this.config      = null;
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

      // Inject config into collector so collect() has it from the first tick
      collector.config = this.config;

      this.initialized = true;

      // Register capabilities now that the module is confirmed configured
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

  async reinitialize() {
    console.log(`   - ♻️  ${MODULE_ID}: reinitializing with fresh settings`);
    this.config      = await settingsService.getCategory(MODULE_ID);
    collector.config = this.config;
    api.config       = this.config;
    console.log(`   - ${MODULE_ID}: config reloaded`);
  }

  // ── Capability Registration ────────────────────────────────────────────────

  /**
   * Reads from collector.lastData — the most recent decoded inverter block,
   * populated after each scheduled collection tick. This avoids triggering
   * an extra Modbus round-trip on every capability request (single-connection
   * constraint: only one TCP connection allowed at a time).
   *
   * solar:read    priority 15 — SolarEdge is the authoritative solar source;
   *                             beats AlphaESS modbus-tcp (10) and cloud (10).
   * solar:curtail priority 15 — stop/resume production via power limit register.
   * grid:read     priority 6  — fallback only; HomeWizard P1 (15) and
   *                             AlphaESS (10) both win when available.
   */
  _registerCapabilities() {

    // ── solar:read ─────────────────────────────────────────────────────────

    capabilityRegistry.register(
      'solar:read',
      () => {
        const data = collector.lastData;
        if (!data) return { power: null, energy_today: null, energy_total: null };
        return {
          power:        data.power_ac    ?? null,
          dc_power:     data.power_dc    ?? null,
          energy_today: data.solar_energy_today ?? null,
          energy_total: data.energy_total != null
            ? Math.round(data.energy_total) / 1000   // Wh → kWh
            : null,
          frequency:    data.frequency   ?? null,
          temperature:  data.temp_sink   ?? null,
          status:       data.status      ?? null,
          voltage:      data.voltage_ln  ?? null,
        };
      },
      15,
      MODULE_ID
    );

    // ── solar:curtail ──────────────────────────────────────────────────────
    // Body: { enabled: false }          → stop  (limit = 0%)
    //       { enabled: true }           → resume (limit = 100%)
    //       { enabled: true, pct: 50 }  → throttle to 50%
    //
    // Requires power control enabled on inverter via its web interface.

    capabilityRegistry.register(
      'solar:curtail',
      async ({ enabled, pct }) => {
        await api.connect(this.config);

        let percentage;
        if (enabled === false || enabled === 'false') {
          percentage = 0;
        } else {
          percentage = (pct !== undefined && pct >= 0 && pct <= 100) ? pct : 100;
        }

        await api.setPowerLimit(percentage);

        return {
          success:       true,
          curtailed:     percentage === 0,
          powerLimitPct: percentage,
        };
      },
      15,
      MODULE_ID
    );

    // ── grid:read ──────────────────────────────────────────────────────────
    // Priority 6 — pure fallback. Only useful if neither HomeWizard P1 (15)
    // nor AlphaESS (10) are available. Provides voltage and frequency only;
    // total_active_power is null because SolarEdge has no grid meter.

    capabilityRegistry.register(
      'grid:read',
      () => {
        const data = collector.lastData;
        if (!data) return { total_active_power: null, l1_voltage: null };
        return {
          total_active_power: null,             // not available without external meter
          l1_voltage:         data.voltage_ln ?? null,
          frequency:          data.frequency  ?? null,
        };
      },
      6,
      MODULE_ID
    );

    console.log(`     - Capabilities registered: solar:read (15), solar:curtail (15), grid:read (6)`);
  }
}

export default new SolarEdgeModule();