// modules/solaredge-modbus/services/curtailState.js
//
// Shared, in-memory desired-state for solar curtailment.
//
// Why a separate file: index.js registers the capability handlers and
// collector.js owns the Modbus connection. Both need this state. Importing
// index.js from collector.js would be circular (index.js already imports
// collector.js), so the state lives here and both import it.
//
// ── Design ────────────────────────────────────────────────────────────────
// Capability handlers NEVER touch Modbus. They only mutate this object.
// The collector applies it inside the connection it already owns, once per
// cycle (20s). This is the same rule the AlphaESS module follows: the
// collector owns the socket, handlers do not open their own.
//
// Consequence: a curtail request takes effect within one collector cycle,
// so up to ~20 seconds. That is intentional and acceptable — curtailment
// responds to hourly price slots, not to milliseconds.
//
// ── Why the collector must re-write every cycle ───────────────────────────
// 0xF322 is a *dynamic* command guarded by the inverter's own watchdog:
//   0xF310 Command Timeout   = 380 s   (read from live hardware)
//   0xF312 Fall-back Limit   = 100 %   (read from live hardware)
// If the inverter stops receiving dynamic commands within the timeout it
// reverts to the fallback on its own. That is the fail-safe: if Wolffie
// crashes mid-curtailment, production resumes within ~6 minutes without
// any action from us. The price of that safety net is that we must keep
// writing while we want the limit to hold.
//
// A 20s cycle against a 380s timeout gives 19 consecutive failed cycles of
// slack before the inverter lets go.

class CurtailState {
  constructor() {
    this.reset();
  }

  reset() {
    /** @type {boolean} true when a limit should currently be applied */
    this.active = false;

    /** @type {number|null} requested cap in watts (what the user/strategy asked for) */
    this.targetWatts = null;

    /** @type {number|null} that cap expressed as % of the inverter's F30C base */
    this.targetPct = null;

    /** @type {number|null} epoch ms at which this request expires (null = no expiry) */
    this.expiresAt = null;

    /** @type {string|null} 'manual' | 'strategy:smart-eco' | 'strategy:pure-solar' */
    this.source = null;

    /** @type {number|null} epoch ms when the request was made */
    this.requestedAt = null;

    // ── Applied state — written by the collector, read by the status handler
    /** @type {number|null} the % the inverter confirmed on read-back */
    this.verifiedPct = null;

    /** @type {number|null} epoch ms of the last successful write+read-back */
    this.lastAppliedAt = null;

    /** @type {string|null} message from the last failed apply */
    this.lastError = null;

    /** @type {number} consecutive failed apply attempts */
    this.failedWrites = 0;

    // ── Hardware facts, refreshed by the collector each time it applies
    /** @type {number|null} F30C — the watt base that targetPct is relative to */
    this.baseLimitW = null;

    /** @type {number|null} F310 — inverter watchdog timeout in seconds */
    this.commandTimeoutS = null;

    /** @type {number|null} F312 — what the inverter reverts to on timeout */
    this.fallbackPct = null;

    /** @type {boolean|null} F300 — is dynamic power control armed */
    this.dynamicControlEnabled = null;

    /**
     * Set on module init and after any stop, so the first collector cycle
     * explicitly writes 100% rather than assuming the inverter is already
     * unrestricted. Cheap insurance against a stale limit surviving a
     * Wolffie restart inside the inverter's 380s window.
     */
    this.needsRestore = true;
  }

  /**
   * Record a curtail request. Does not touch hardware.
   * @param {{ watts:number, pct:number, durationHours?:number, source?:string }} req
   */
  request({ watts, pct, durationHours, source }) {
    this.active       = true;
    this.targetWatts  = watts;
    this.targetPct    = pct;
    this.source       = source ?? 'manual';
    this.requestedAt  = Date.now();
    this.expiresAt    = (durationHours && durationHours > 0)
      ? Date.now() + durationHours * 3600_000
      : null;
    this.needsRestore = false;
    this.lastError    = null;
    this.failedWrites = 0;
  }

  /** Clear the request. The collector will write 100% on its next cycle. */
  release() {
    this.active       = false;
    this.targetWatts  = null;
    this.targetPct    = null;
    this.expiresAt    = null;
    this.source       = null;
    this.requestedAt  = null;
    this.needsRestore = true;
  }

  /** True when a duration was given and has now elapsed. */
  isExpired() {
    return this.active && this.expiresAt !== null && Date.now() >= this.expiresAt;
  }

  /** Seconds left on the current request, or null when there is no expiry. */
  remainingSeconds() {
    if (!this.active || this.expiresAt === null) return null;
    return Math.max(0, Math.round((this.expiresAt - Date.now()) / 1000));
  }

  /** Snapshot for the solar:curtail-status capability. No I/O. */
  snapshot() {
    return {
      active:            this.active,
      targetWatts:       this.targetWatts,
      targetPct:         this.targetPct,
      verifiedPct:       this.verifiedPct,
      remainingSeconds:  this.remainingSeconds(),
      expiresAt:         this.expiresAt ? new Date(this.expiresAt).toISOString() : null,
      requestedAt:       this.requestedAt ? new Date(this.requestedAt).toISOString() : null,
      source:            this.source,
      lastAppliedAt:     this.lastAppliedAt ? new Date(this.lastAppliedAt).toISOString() : null,
      lastError:         this.lastError,
      failedWrites:      this.failedWrites,
      baseLimitW:        this.baseLimitW,
      commandTimeoutS:   this.commandTimeoutS,
      fallbackPct:       this.fallbackPct,
      dynamicControlEnabled: this.dynamicControlEnabled,
      // True when we believe a limit is applied but the last write failed —
      // the UI should surface this rather than showing a calm "curtailing".
      degraded: this.active && this.failedWrites > 0,
    };
  }
}

export default new CurtailState();