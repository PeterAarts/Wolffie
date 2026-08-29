// modules/alphaess-modbus-tcp/index.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import db from '../../core/database.js';
import settingsService from '../../core/system/services/settingsService.js';
import api from './services/api.js';
import collector from './services/collector.js';
import capabilityRegistry from '../../core/capabilityRegistry.js';
import { padName } from '../../core/utils/logger.js';
const PREFIX = padName('AlphaESS ModBus');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const manifestPath = path.join(__dirname, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const MODULE_ID = 'alphaess-modbus-tcp';
const PRIORITY  = 10;

// ── Health / recovery tuning ─────────────────────────────────────────────────
//
// FAILURE_THRESHOLD: consecutive failed collection cycles before this module
// releases its capabilities so a lower-priority provider (alphaess-cloud) can
// take over. At the configured 20 s collector interval this is ~5 minutes of
// sustained failure — long enough that a transient network blip or a single
// missed cycle never triggers failover.
//
// WATCHDOG_INTERVAL_MS: how often to check module health and, when we are
// currently unregistered, probe for recovery.
const FAILURE_THRESHOLD   = 15;
const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;

class AlphaESSModbusTCPModule {
  constructor() {
    this.manifest    = manifest;
    this.initialized = false;
    this.connected   = false;
    this.config      = null;

    // True while this module's capabilities are present in the registry.
    // Distinguishes "we deliberately released them after sustained failure"
    // from "we never registered" — the watchdog needs that distinction.
    this.capabilitiesRegistered = false;

    this._watchdogTimer = null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize() {
    if (this.initialized) return;
    try {
      console.log(`   - \x1b[93m${this.manifest.id} \x1b[37m`);
      this.config = await settingsService.getCategory(MODULE_ID);

      if (!this.config || this.config.enabled === false) return;

      console.log(`     - ModBus IP: ${this.config.host}:${this.config.port}`);

      // Store config in api so withConnection() works without parameter passing.
      api.setConfig(this.config);

      // Safety check using the API's TCP probe
      const isAlive = await api.checkStatus(this.config.host, this.config.port);

      if (isAlive) {
        this.connected = true;
        console.log('\x1b[37m     - ModBus connection established \x1b[32m✓\x1b[37m');

        // Safety reset: uses withConnection(fn, true) — connects, resets dispatch
        // registers, then closes (closeAfter=true). The first collection cycle
        // then opens its own persistent connection via withConnection(fn, false).
        await api.resetOnStartup();
      } else {
        this.connected = false;
        console.warn('\x1b[91m     - ModBus connection failed (port unreachable) — capabilities registered anyway\x1b[37m');
      }

      // Pre-load routes so routeManager can find them as module.routes
      this.routes = await this.getRoutes();

      // Inject config into collector so it can connect without re-fetching settings
      collector.config = this.config;

      this.initialized = true;

      // Always register capabilities — even when offline at startup.
      // If the inverter is unreachable the handlers throw, and the registry
      // falls back to the next provider (alphaess-cloud at priority 10).
      // Capabilities are released only by the health watchdog, after
      // FAILURE_THRESHOLD consecutive failed collection cycles.
      this._registerCapabilities();

      this._startWatchdog();

    } catch (error) {
      console.error('\x1b[91m     - Failed to initialize module:', error.message);
      throw error;
    }
  }

  async stop() {
    this._stopWatchdog();
  }

  async collect() {
    // Skip collection entirely if a higher-priority module has taken over
    // all capabilities this module provides. This keeps energy_snapshots clean —
    // only the winning module writes rows for its owned fields.
    const ownedCapabilities = capabilityRegistry.list()
      .filter(c => c.moduleId === MODULE_ID);

    if (ownedCapabilities.length === 0) {
      console.log(`   • ${PREFIX}: no capabilities owned, skipping collection`);
      return true;
    }

    return await collector.collect();
  }

  getStatus() {
    return {
      ...collector.getStatus(),
      connected: this.connected,
      capabilitiesRegistered: this.capabilitiesRegistered,
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
      console.error(`[${PREFIX}] Route loading error:`, error.message);
    }
    return null;
  }

  /**
   * Re-reads settings from DB and re-injects them into api + collector.
   * Called by the core settings route after any setting change.
   *
   * IMPORTANT — this method never unregisters capabilities.
   *
   * It previously ran api.checkStatus() and tore the capabilities out of the
   * registry when that probe returned false. checkStatus() opens a brand-new
   * raw TCP socket; a single unlucky moment (collector mid-reconnect, or the
   * inverter's TCP stack briefly refusing a second session) was therefore
   * enough to permanently disable the module — collect() saw zero owned
   * capabilities and returned early forever, so the collector never ran and
   * nothing ever re-registered. Observed 2026-08-28: a routine settings save
   * from the mobile UI killed battery monitoring and battery:stop for 6.5 hours.
   *
   * A settings save is not a connectivity event. The probe below is retained
   * for its log line only — its result never gates registration.
   *
   * Returns a status object so the caller can distinguish a clean
   * reinitialisation from a degraded one.
   */
  async reinitialize() {
    console.log(`   - RESTART ${MODULE_ID}: reinitializing with fresh settings`);

    this.config = await settingsService.getCategory(MODULE_ID);

    // Re-inject config into api and collector
    api.setConfig(this.config);
    collector.config = this.config;

    // Informational probe only — does NOT gate registration.
    // May report false while the collector holds an open session; that is
    // expected and harmless.
    const isAlive = await api.checkStatus(this.config.host, this.config.port);
    this.connected = isAlive;

    console.log(`   - ${PREFIX}: connection ${isAlive ? '✓' : '✗'} (${this.config.host}:${this.config.port})`);

    // Always (re)register. Idempotent — see _registerCapabilities().
    this._registerCapabilities();

    // Re-arm the watchdog against the new config.
    this._startWatchdog();

    return {
      moduleId:  MODULE_ID,
      connected: isAlive,
      registered: this.capabilitiesRegistered,
    };
  }

  // ── Health watchdog ────────────────────────────────────────────────────────

  _startWatchdog() {
    this._stopWatchdog();

    this._watchdogTimer = setInterval(
      () => this._checkHealth().catch(e =>
        console.warn(`   • ${PREFIX}: watchdog error — ${e.message}`)
      ),
      WATCHDOG_INTERVAL_MS
    );

    // Do not keep the Node process alive purely for this timer.
    if (typeof this._watchdogTimer.unref === 'function') {
      this._watchdogTimer.unref();
    }
  }

  _stopWatchdog() {
    if (this._watchdogTimer) {
      clearInterval(this._watchdogTimer);
      this._watchdogTimer = null;
    }
  }

  /**
   * Decides whether this module should be holding its capabilities.
   *
   * Registered   + sustained failure  → release, so alphaess-cloud can take over.
   * Unregistered + inverter reachable → reclaim.
   *
   * The recovery probe only runs while we are unregistered. In that state
   * collect() is short-circuiting, so the collector holds no socket and the
   * probe cannot contend with it — which is precisely the contention that
   * caused the original fault.
   */
  async _checkHealth() {
    if (!this.config || this.config.enabled === false) return;

    if (this.capabilitiesRegistered) {
      const { consecutiveErrors } = collector.getStatus();

      if (consecutiveErrors >= FAILURE_THRESHOLD) {
        console.warn(
          `\x1b[91m   • ${PREFIX}: ${consecutiveErrors} consecutive failures — releasing capabilities for failover\x1b[37m`
        );
        this._unregisterCapabilities();
      }
      return;
    }

    // Unregistered — attempt recovery.
    const isAlive = await api.checkStatus(this.config.host, this.config.port);
    this.connected = isAlive;

    if (isAlive) {
      console.log(`\x1b[32m   • ${PREFIX}: inverter reachable again — reclaiming capabilities\x1b[37m`);
      collector.consecutiveErrors = 0;
      collector.lastError         = null;
      this._registerCapabilities();
    } else {
      console.log(`   • ${PREFIX}: still unreachable (${this.config.host}:${this.config.port}) — retrying in 5 min`);
    }
  }

  _unregisterCapabilities() {
    capabilityRegistry.unregister(MODULE_ID);
    this.capabilitiesRegistered = false;
  }

  // ── Capability Registration ────────────────────────────────────────────────

  _registerCapabilities() {

    // Idempotent: clear any existing registrations for this module first, so a
    // repeated call (settings save, watchdog recovery) replaces rather than
    // duplicates. Safe regardless of how capabilityRegistry.register() handles
    // a repeat registration of the same key.
    capabilityRegistry.unregister(MODULE_ID);

    // ── Battery reads ──────────────────────────────────────────────────────

    capabilityRegistry.register(
      'battery:read',
      async () => {
        // Read from the collector's in-memory cache — no new Modbus connection,
        // no DB import needed. Data is at most one collection cycle old (~20 s).
        const d = collector.getLastSnapshot();
        if (!d) return { soc: null, power: null, charge_today: null, discharge_today: null };
        const b = d.battery;
        return {
          soc:             b.soc             ?? null,
          power:           b.power != null ? b.power * -1 : null,
          charge_today:    b.charge_today    ?? null,
          discharge_today: b.discharge_today ?? null,
        };
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
        const { watts, targetSOC, durationHours, origin } = body;
        await api.startCharge(watts, targetSOC, durationHours, origin || 'capability');
        return { success: true, command: { mode: 'charge-from-grid', watts, targetSOC, durationHours, origin } };
      },
      PRIORITY,
      MODULE_ID
    );

    capabilityRegistry.register(
      'battery:discharge-to-grid',
      async (body) => {
        const { watts, minimumSOC, durationHours, origin } = body;
        await api.startDischarge(watts, minimumSOC, durationHours, origin || 'capability');
        return { success: true, command: { mode: 'discharge-to-grid', watts, minimumSOC, durationHours, origin } };
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
    capabilityRegistry.register(
      'battery:set-charge-limit',
      async (body) => {
        const { percent } = body;
        await api.writeMinSoC(percent);
        return { success: true, chargeLimitPct: percent };
      },
      PRIORITY,
      MODULE_ID
    );
    // ── Solar reads ────────────────────────────────────────────────────────

    capabilityRegistry.register(
      'solar:read',
      async () => {
        const d = collector.getLastSnapshot();
        if (!d) return { power: null, energy_today: null, energy_total: null };
        const s = d.solar;
        return {
          power:        s.total_power  ?? null,
          energy_today: s.energy_today ?? null,
          energy_total: s.energy_total ?? null,
        };
      },
      PRIORITY,
      MODULE_ID
    );

    // ── Grid reads ─────────────────────────────────────────────────────────

    capabilityRegistry.register(
      'grid:read',
      async () => {
        const d = collector.getLastSnapshot();
        if (!d) return { power: null, voltage_l1: null, frequency: null, import_today: null, export_today: null };
        const g = d.grid;

        return {
          power:        g.total_active_power ?? null,
          voltage_l1:   g.l1_voltage         ?? null,
          frequency:    d.system?.inv_freq    ?? null,
          import_today: g.import_today        ?? null,
          export_today: g.export_today        ?? null,
        };
      },
      PRIORITY,
      MODULE_ID
    );

    // ── Grid status (outage detection) ────────────────────────────────────
    // Returns { gridConnected: bool, mode: string } from last collector cycle.
    // Non-throwing — returns gridConnected: true if no data yet (safe default).

    capabilityRegistry.register(
      'grid:status',
      () => {
        const d = collector.getLastSnapshot();
        if (!d?.inverterMode) return { gridConnected: true, mode: 'Unknown' };
        return {
          gridConnected: d.inverterMode.gridConnected,
          mode:          d.inverterMode.mode,
        };
      },
      PRIORITY,
      MODULE_ID
    );

    // ── Home load (derived) ────────────────────────────────────────────────
    // Priority 5 — a P1 meter module registers home:read at priority 10
    // and automatically takes over when available.

    capabilityRegistry.register(
      'home:read',        // was: grid:read
      async () => {
        // ... existing handler code unchanged ...
        return {
          power: hasPhaseData ? p_l1 + p_l2 + p_l3 : (d.active_power_w ?? null),
          import_today: importToday,
          export_today: exportToday,
        };
      },
      PRIORITY,           // 15 — wins over AlphaESS home:read at 5
      MODULE_ID
    );

    this.capabilitiesRegistered = true;
    console.log(`     - Capabilities registered`);
  }
}

export default new AlphaESSModbusTCPModule();