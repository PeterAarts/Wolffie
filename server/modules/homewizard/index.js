// modules/homewizard/index.js
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import collector from './services/collector.js';
import routes from './routes/index.js';
import settingsService from '../../core/system/services/settingsService.js';
import capabilityRegistry from '../../core/capabilityRegistry.js';
import homewizardAPI from './services/api.js';
import db from '../../core/database.js';
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

    // ── grid:read via HWE-P1 ──────────────────────────────────────────────────
    //
    // Live power values (power, power_l1/2/3, voltage, current, frequency) are
    // fetched directly from the P1 device for real-time accuracy.
    //
    // import_today / export_today are read from the most recent energy_snapshots
    // row for source = 'homewizard' — the collector already applies a midnight
    // baseline delta there, converting lifetime cumulative kWh into today's value.
    // Reading the raw device totals here would return lifetime values (~16000 kWh)
    // which break the derived load_energy_today calculation in collectorManager.

    capabilityRegistry.register(
      'grid:read',
      async () => {
        // ── Live device query — real-time power values ─────────────────────
        const [deviceRows] = await db.pool.query(
          `SELECT * FROM device_settings
            WHERE module       = 'homewizard'
              AND product_type = 'HWE-P1'
              AND enabled      = 1
            ORDER BY priority DESC
            LIMIT 1`
        );

        if (!deviceRows.length) throw new Error('No enabled HWE-P1 device found');

        const device = deviceRows[0];
        const d      = await homewizardAPI.getData(device.ip_address, device.port || 80);

        const p_l1 = d.active_power_l1_w ?? 0;
        const p_l2 = d.active_power_l2_w ?? 0;
        const p_l3 = d.active_power_l3_w ?? 0;
        const hasPhaseData = d.active_power_l1_w != null
                          || d.active_power_l2_w != null
                          || d.active_power_l3_w != null;

        // ── Daily totals — from energy_snapshots baseline delta ────────────
        // The homewizard collector writes correctly computed daily deltas to
        // energy_snapshots. Reading from there avoids returning lifetime totals.
        let importToday = null;
        let exportToday = null;

        try {
          const [snapRows] = await db.pool.query(
            `SELECT grid_energy_import_today, grid_energy_export_today
               FROM energy_snapshots
              WHERE source = 'homewizard'
              ORDER BY timestamp DESC
              LIMIT 1`
          );
          if (snapRows.length) {
            importToday = snapRows[0].grid_energy_import_today ?? null;
            exportToday = snapRows[0].grid_energy_export_today ?? null;
          }
        } catch (snapErr) {
          console.warn(`   • ${PREFIX} grid:read: could not read daily totals from snapshot — ${snapErr.message}`);
        }

        return {
          // Netto totaal — som van de drie fases (+ = import, - = export)
          power:        hasPhaseData ? p_l1 + p_l2 + p_l3
                                     : (d.active_power_w ?? null),

          // Per fase
          power_l1:     d.active_power_l1_w   ?? null,  // W
          power_l2:     d.active_power_l2_w   ?? null,  // W
          power_l3:     d.active_power_l3_w   ?? null,  // W

          // Spanning
          voltage_l1:   d.active_voltage_l1_v ?? null,  // V
          voltage_l2:   d.active_voltage_l2_v ?? null,  // V
          voltage_l3:   d.active_voltage_l3_v ?? null,  // V

          // Stroom
          current_l1:   d.active_current_l1_a ?? null,  // A
          current_l2:   d.active_current_l2_a ?? null,  // A
          current_l3:   d.active_current_l3_a ?? null,  // A

          // Frequentie
          frequency:    d.active_frequency_hz ?? null,  // Hz

          // Daily deltas — from energy_snapshots, not raw device lifetime totals
          import_today: importToday,  // kWh
          export_today: exportToday,  // kWh
        };
      },
      PRIORITY,
      MODULE_ID
    );

    console.log(`     - Capabilities registered (grid:read @ priority ${PRIORITY})`);
  }
}

export default new HomeWizardModule();