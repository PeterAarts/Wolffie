// modules/solaredge-modbus/index.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import api from './services/api.js';
import collector from './services/collector.js';
import curtailState from './services/curtailState.js';
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

// Absolute floor for a curtail request, in watts. Below roughly 30-60 W a
// single-phase SolarEdge inverter cannot hold its output relays closed, so
// it disconnects and needs a grid-monitoring reconnect cycle before it can
// resume — a limit of 0 turns "resume production" into a multi-minute wait.
// Staying above that keeps the inverter online and instantly restorable.
const MIN_CURTAIL_WATTS = 100;

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

      // Start from a clean slate. needsRestore = true makes the first
      // collector cycle explicitly write 100%, rather than assuming the
      // inverter is unrestricted. If Wolffie restarted inside the inverter's
      // 380s command-timeout window a stale limit could still be in force.
      curtailState.reset();

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

  /**
   * Force-abort whatever connection the collector currently has in flight.
   * Called by CollectorManager when a collection cycle has exceeded its
   * hang-timeout and the manager has stopped waiting on it. Optional
   * contract — CollectorManager checks for this method before calling it,
   * so it's safe even though not every module needs to implement it.
   */
  async abort() {
    return await this.collector.abort?.();
  }

  getStatus() {
    const status = this.collector.getStatus?.() || {};
    return {
      initialized: this.initialized,
      collector:   status,
      curtail:     curtailState.snapshot(),
    };
  }

  getRoutes() { return this.routes; }

  async reinitialize() {
    console.log(`   - ♻️  ${MODULE_ID}: reinitializing with fresh settings`);
    this.config      = await settingsService.getCategory(MODULE_ID);
    collector.config = this.config;
    api.config       = this.config;

    // Re-register unconditionally. Capability registration must never be
    // gated on a connection probe: this inverter accepts only one Modbus TCP
    // client at a time, so any probe opening a second connection while the
    // collector holds the socket will always fail. Same lesson as AlphaESS
    // v1.1.8.
    this._registerCapabilities();

    console.log(`   - ${MODULE_ID}: config reloaded`);
  }

  // ── Capability Registration ────────────────────────────────────────────────

  /**
   * Reads from collector.lastData — the most recent decoded inverter block,
   * populated after each scheduled collection tick. This avoids triggering
   * an extra Modbus round-trip on every capability request (single-connection
   * constraint: only one TCP connection allowed at a time).
   *
   * solar:read           priority 15 — SolarEdge is the authoritative solar
   *                                    source; beats AlphaESS modbus-tcp (10)
   *                                    and cloud (10).
   * solar:curtail        priority 15 — request a production cap. Does NOT
   *                                    talk to the inverter; see below.
   * solar:curtail-status priority 15 — in-memory state, no hardware I/O.
   * grid:read            priority 6  — fallback only; HomeWizard P1 (15) and
   *                                    AlphaESS (10) both win when available.
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
    //
    // Body:
    //   { curtail: true, watts: 400, durationHours: 2, source: 'manual' }
    //   { curtail: false, source: 'manual' }                      → release
    //
    // Legacy shape still accepted so an un-migrated caller cannot silently
    // become a no-op:
    //   { enabled: false }          → curtail to the minimum floor
    //   { enabled: true }           → release
    //   { enabled: true, pct: 50 }  → cap at 50% of the F30C base
    //
    // THIS HANDLER DOES NOT TOUCH MODBUS.
    //
    // The collector owns the socket. A handler that called api.connect()
    // mid-cycle would close the collector's live client and break its
    // in-flight read — and with a per-cycle heartbeat that collision would
    // be constant rather than occasional. So the handler records intent and
    // the collector applies it inside the connection it already holds,
    // within one cycle (~20s).
    //
    // The 20s latency is deliberate. Curtailment tracks hourly price slots;
    // it does not need sub-second response, and it is not worth breaking the
    // single-connection rule to get it.

    capabilityRegistry.register(
      'solar:curtail',
      async (body = {}) => {
        const base = curtailState.baseLimitW ?? 3000;

        // ── Release ────────────────────────────────────────────────────────
        const isRelease =
          body.curtail === false || body.curtail === 'false' ||
          body.enabled === true  || body.enabled === 'true';

        if (isRelease) {
          const was = curtailState.active;
          curtailState.release();
          console.log(`   • ${PREFIX} - Curtail released${was ? '' : ' (was not active)'}` +
                      ` — 100% will be written on the next collector cycle`);
          return {
            success:      true,
            curtailing:   false,
            appliedWithin:'next collector cycle',
            ...curtailState.snapshot(),
          };
        }

        // ── Request ────────────────────────────────────────────────────────
        // Watts is the primary unit: it is what the user reasons about
        // against house load. Percent is accepted for legacy callers.
        let watts;
        if (Number.isFinite(body.watts)) {
          watts = Number(body.watts);
        } else if (Number.isFinite(body.pct)) {
          watts = (Number(body.pct) / 100) * base;
        } else {
          // Legacy { enabled: false } meant "stop solar". Honour the intent
          // but never write 0 — that drops the inverter's output relays.
          watts = MIN_CURTAIL_WATTS;
        }

        if (!Number.isFinite(watts)) {
          throw new Error(`solar:curtail: could not derive a watt target from ${JSON.stringify(body)}`);
        }

        watts = Math.max(MIN_CURTAIL_WATTS, Math.min(base, watts));
        const pct = (watts / base) * 100;

        const durationHours = Number.isFinite(body.durationHours)
          ? Number(body.durationHours)
          : null;

        curtailState.request({
          watts,
          pct,
          durationHours,
          source: body.source ?? 'manual',
        });

        console.log(
          `   • ${PREFIX} - Curtail requested: ${Math.round(watts)} W ` +
          `(${pct.toFixed(2)}% of ${base} W)` +
          (durationHours ? ` for ${durationHours}h` : ' (no expiry)') +
          ` [${curtailState.source}] — applies on the next collector cycle`
        );

        return {
          success:       true,
          curtailing:    true,
          targetWatts:   Math.round(watts),
          targetPct:     parseFloat(pct.toFixed(3)),
          appliedWithin: 'next collector cycle',
          ...curtailState.snapshot(),
        };
      },
      15,
      MODULE_ID
    );

    // ── solar:curtail-status ───────────────────────────────────────────────
    // In-memory only, mirroring battery:status. The frontend polls this to
    // decide whether to show the Stop button and the active banner.
    //
    // verifiedPct is what the inverter confirmed on read-back, not what
    // Wolffie asked for. When the two disagree, or failedWrites > 0, the
    // snapshot reports degraded: true so the UI can say so instead of
    // showing a reassuring green state over a broken write path.

    capabilityRegistry.register(
      'solar:curtail-status',
      () => curtailState.snapshot(),
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

    console.log(
      `     - Capabilities registered: solar:read (15), solar:curtail (15), ` +
      `solar:curtail-status (15), grid:read (6)`
    );
  }
}

export default new SolarEdgeModule();