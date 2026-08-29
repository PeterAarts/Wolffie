// core/system/services/eventLogService.js
//
// Unified event log — the single audit trail for every module in Wolffie.
//
// Events are the primary record. Events with sufficient severity automatically
// surface as "alerts" on the dashboard (severity >= alertThreshold).
// Active events (resolved_at IS NULL) represent ongoing state — e.g. a manual
// discharge in progress. Resolved events are historical.
//
// Usage from any module:
//
//   import eventLog from '../../system/services/eventLogService.js';
//
//   // Fire-and-forget informational event
//   eventLog.log('collector:alphaess-modbus-tcp', 'collector', 'collect_success',
//     'info', 'Collected 12 registers in 340ms');
//
//   // Trackable event with lifecycle (returns id for later resolution)
//   const id = await eventLog.log('manual:api', 'dispatch', 'discharge_started',
//     'notice', 'Manual discharge at 3000W', { watts: 3000, soc: 82 });
//
//   // ... later, when the discharge completes:
//   await eventLog.resolve(id);
//
//   // Or resolve all active events from a source:
//   await eventLog.resolveBySource('manual:api', 'discharge_started');
//
// Severity levels (lowest → highest):
//   debug    — verbose diagnostics, not stored unless log level is debug
//   info     — normal operation confirmations
//   notice   — noteworthy but expected (default alert threshold)
//   warning  — something may need attention
//   error    — something failed
//   critical — system-level failure requiring immediate attention
//
// The alert threshold is configurable via system_settings:
//   category = 'event_log', setting_key = 'alert_threshold', value = 'notice'

import db from '../../database.js';
import { padName } from '../../utils/logger.js';

const PREFIX = padName('EventLog');

// Severity levels ordered by significance
const SEVERITY_LEVELS = {
  debug:    0,
  info:     1,
  notice:   2,
  warning:  3,
  error:    4,
  critical: 5,
};

// Valid categories — kept as a set for O(1) validation
const VALID_CATEGORIES = new Set([
  'dispatch',    // battery charge/discharge commands
  'collector',   // data collection lifecycle
  'strategy',    // strategy decisions and switches
  'settings',    // configuration changes
  'system',      // core system events (startup, shutdown, migration)
  'device',      // smart device control events
  'solar',       // solar forecast and curtailment events
  'grid',        // grid status changes
]);

// Defaults
const DEFAULT_ALERT_THRESHOLD   = 'notice';
const DEFAULT_RETENTION_DAYS    = 180;   // 6 months
const DEFAULT_LOG_LEVEL         = 'info'; // don't store debug by default
const MAX_HISTORY_LIMIT         = 500;
const DEFAULT_HISTORY_LIMIT     = 50;

class EventLogService {
  constructor() {
    this._initialized = false;
    this._alertThreshold = DEFAULT_ALERT_THRESHOLD;
    this._retentionDays  = DEFAULT_RETENTION_DAYS;
    this._logLevel       = DEFAULT_LOG_LEVEL;
  }

  // ── Initialization ──────────────────────────────────────────────────────────

  /**
   * Ensure the event_log table exists and load configuration.
   * Called lazily on first log() call, or explicitly during server startup.
   * Safe to call multiple times — no-ops after the first.
   */
  async initialize() {
    if (this._initialized) return;

    try {
      // Create table if it doesn't exist (idempotent)
      db.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS event_log (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')),
          source      TEXT    NOT NULL,
          category    TEXT    NOT NULL,
          event       TEXT    NOT NULL,
          severity    TEXT    NOT NULL DEFAULT 'info',
          message     TEXT    NOT NULL,
          metadata    TEXT,
          resolved_at TEXT
        )
      `);

      // Indices for the two primary access patterns:
      //   1. Dashboard: active events above severity threshold
      //   2. History:   paginated by timestamp with optional filters
      db.sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_event_log_active
          ON event_log(severity, resolved_at)
          WHERE resolved_at IS NULL
      `);
      db.sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_event_log_timestamp
          ON event_log(timestamp DESC)
      `);
      db.sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_event_log_category
          ON event_log(category)
      `);
      db.sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_event_log_source
          ON event_log(source)
      `);

      // Load configuration from system_settings (if present)
      await this._loadConfig();

      this._initialized = true;
      console.log(`   • ${PREFIX} — initialized (threshold: ${this._alertThreshold}, retention: ${this._retentionDays}d)`);
    } catch (err) {
      console.error(`   • ${PREFIX} — initialization failed: ${err.message}`);
      // Set initialized anyway to prevent infinite retry loops.
      // The service degrades gracefully — log() calls will fail individually.
      this._initialized = true;
    }
  }

  /**
   * Load alert threshold, retention days, and log level from system_settings.
   * Falls back to defaults if not configured.
   */
  async _loadConfig() {
    try {
      const [rows] = await db.pool.query(
        `SELECT setting_key, setting_value
           FROM system_settings
          WHERE category = 'event_log'`
      );

      for (const row of rows) {
        switch (row.setting_key) {
          case 'alert_threshold':
            if (SEVERITY_LEVELS[row.setting_value] !== undefined) {
              this._alertThreshold = row.setting_value;
            }
            break;
          case 'retention_days': {
            const days = Number(row.setting_value);
            if (days > 0) this._retentionDays = days;
            break;
          }
          case 'log_level':
            if (SEVERITY_LEVELS[row.setting_value] !== undefined) {
              this._logLevel = row.setting_value;
            }
            break;
        }
      }
    } catch (_) {
      // system_settings may not have event_log rows yet — use defaults
    }
  }

  // ── Core API ────────────────────────────────────────────────────────────────

  /**
   * Log an event.
   *
   * @param {string} source    — who raised it (e.g. 'strategy:smart-eco', 'manual:api')
   * @param {string} category  — grouping key (e.g. 'dispatch', 'collector')
   * @param {string} event     — what happened (e.g. 'discharge_started')
   * @param {string} severity  — 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical'
   * @param {string} message   — human-readable description
   * @param {object} [metadata] — optional structured data (stored as JSON)
   * @returns {number|null}    — inserted row id, or null if suppressed/failed
   */
  async log(source, category, event, severity, message, metadata = null) {
    if (!this._initialized) await this.initialize();

    // Validate severity
    if (SEVERITY_LEVELS[severity] === undefined) {
      console.warn(`   • ${PREFIX} - invalid severity '${severity}', defaulting to 'info'`);
      severity = 'info';
    }

    // Suppress events below configured log level
    if (SEVERITY_LEVELS[severity] < SEVERITY_LEVELS[this._logLevel]) {
      return null;
    }

    // Validate category — warn but don't reject (extensible)
    if (!VALID_CATEGORIES.has(category)) {
      console.warn(`   • ${PREFIX} - unknown category '${category}' (allowed but consider adding to VALID_CATEGORIES)`);
    }

    try {
      const metadataJson = metadata ? JSON.stringify(metadata) : null;

      const [result] = await db.pool.query(
        `INSERT INTO event_log (source, category, event, severity, message, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [source, category, event, severity, message, metadataJson]
      );

      // Console output for visibility during development
      const sevTag = severity.toUpperCase().padEnd(8);
      const isAlert = SEVERITY_LEVELS[severity] >= SEVERITY_LEVELS[this._alertThreshold];
      const alertFlag = isAlert ? ' 🔔' : '';
      console.log(`   • ${PREFIX} - ${sevTag} ${source}/${event} — ${message}${alertFlag}`);

      return result.insertId ?? null;
    } catch (err) {
      console.error(`   • ${PREFIX} — log failed: ${err.message}`);
      return null;
    }
  }

  // ── Resolution ──────────────────────────────────────────────────────────────

  /**
   * Resolve a specific event by its id.
   *
   * @param {number} id — the event_log row id
   * @returns {boolean} — true if a row was updated
   */
  async resolve(id) {
    if (!this._initialized) await this.initialize();

    try {
      const [result] = await db.pool.query(
        `UPDATE event_log
            SET resolved_at = strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')
          WHERE id = ? AND resolved_at IS NULL`,
        [id]
      );
      return (result.affectedRows ?? 0) > 0;
    } catch (err) {
      console.error(`   • ${PREFIX} - resolve(${id}) failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Resolve all active events matching a source and optionally an event name.
   * Useful for clearing state: e.g. resolve all active dispatches from manual:api.
   *
   * @param {string} source       — event source to match
   * @param {string} [eventName]  — optional event name filter
   * @returns {number}            — number of rows resolved
   */
  async resolveBySource(source, eventName = null) {
    if (!this._initialized) await this.initialize();

    try {
      let sql = `UPDATE event_log
                    SET resolved_at = strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')
                  WHERE source = ? AND resolved_at IS NULL`;
      const params = [source];

      if (eventName) {
        sql += ' AND event = ?';
        params.push(eventName);
      }

      const [result] = await db.pool.query(sql, params);
      return result.affectedRows ?? 0;
    } catch (err) {
      console.error(`   • ${PREFIX} - resolveBySource(${source}) failed: ${err.message}`);
      return 0;
    }
  }

  /**
   * Resolve all active events in a category.
   *
   * @param {string} category
   * @returns {number} — number of rows resolved
   */
  async resolveByCategory(category) {
    if (!this._initialized) await this.initialize();

    try {
      const [result] = await db.pool.query(
        `UPDATE event_log
            SET resolved_at = strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')
          WHERE category = ? AND resolved_at IS NULL`,
        [category]
      );
      return result.affectedRows ?? 0;
    } catch (err) {
      console.error(`   • ${PREFIX} - resolveByCategory(${category}) failed: ${err.message}`);
      return 0;
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  /**
   * Get all active (unresolved) events at or above the alert threshold.
   * Used by the dashboard to surface current alerts.
   *
   * @param {string} [minSeverity] — override alert threshold (default: configured threshold)
   * @returns {Array} — active events, newest first
   */
  async getActive(minSeverity = null) {
    if (!this._initialized) await this.initialize();

    const threshold = minSeverity ?? this._alertThreshold;
    const minLevel  = SEVERITY_LEVELS[threshold] ?? SEVERITY_LEVELS[DEFAULT_ALERT_THRESHOLD];

    // Filter in JS since SQLite doesn't natively sort by severity enum.
    // The active set is small (typically < 20 rows), so this is fine.
    try {
      const [rows] = await db.pool.query(
        `SELECT id, timestamp, source, category, event, severity, message, metadata
           FROM event_log
          WHERE resolved_at IS NULL
          ORDER BY timestamp DESC
          LIMIT 100`
      );

      return rows
        .filter(r => (SEVERITY_LEVELS[r.severity] ?? 0) >= minLevel)
        .map(r => ({
          ...r,
          metadata: r.metadata ? JSON.parse(r.metadata) : null,
        }));
    } catch (err) {
      console.error(`   • ${PREFIX} - getActive failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Get paginated event history with optional filters.
   *
   * @param {object} options
   * @param {string}  [options.category]   — filter by category
   * @param {string}  [options.source]     — filter by source (exact or prefix with *)
   * @param {string}  [options.severity]   — minimum severity filter
   * @param {string}  [options.from]       — ISO date/datetime lower bound
   * @param {string}  [options.to]         — ISO date/datetime upper bound
   * @param {number}  [options.limit=50]   — page size (max 500)
   * @param {number}  [options.offset=0]   — pagination offset
   * @returns {{ events: Array, total: number, limit: number, offset: number }}
   */
  async getHistory({ category, source, severity, from, to, limit = DEFAULT_HISTORY_LIMIT, offset = 0 } = {}) {
    if (!this._initialized) await this.initialize();

    const conditions = [];
    const params     = [];

    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
    if (source) {
      if (source.endsWith('*')) {
        conditions.push('source LIKE ?');
        params.push(source.slice(0, -1) + '%');
      } else {
        conditions.push('source = ?');
        params.push(source);
      }
    }
    if (severity && SEVERITY_LEVELS[severity] !== undefined) {
      // Include this severity and above — filter all valid severity names
      const minLevel = SEVERITY_LEVELS[severity];
      const allowed  = Object.entries(SEVERITY_LEVELS)
        .filter(([, v]) => v >= minLevel)
        .map(([k]) => k);
      conditions.push(`severity IN (${allowed.map(() => '?').join(',')})`);
      params.push(...allowed);
    }
    if (from) {
      conditions.push('timestamp >= ?');
      params.push(from);
    }
    if (to) {
      conditions.push('timestamp <= ?');
      params.push(to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const safeLimit  = Math.max(1, Math.min(MAX_HISTORY_LIMIT, Number(limit) || DEFAULT_HISTORY_LIMIT));
    const safeOffset = Math.max(0, Number(offset) || 0);

    try {
      // Count total matching rows (for pagination)
      const [countRows] = await db.pool.query(
        `SELECT COUNT(*) AS total FROM event_log ${where}`,
        params
      );
      const total = countRows[0]?.total ?? 0;

      // Fetch page
      const [rows] = await db.pool.query(
        `SELECT id, timestamp, source, category, event, severity, message, metadata, resolved_at
           FROM event_log ${where}
          ORDER BY timestamp DESC
          LIMIT ? OFFSET ?`,
        [...params, safeLimit, safeOffset]
      );

      const events = rows.map(r => ({
        ...r,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
      }));

      return { events, total, limit: safeLimit, offset: safeOffset };
    } catch (err) {
      console.error(`   • ${PREFIX} - getHistory failed: ${err.message}`);
      return { events: [], total: 0, limit: safeLimit, offset: safeOffset };
    }
  }

  // ── Maintenance ─────────────────────────────────────────────────────────────

  /**
   * Delete resolved events older than the configured retention period.
   * Unresolved events are NEVER pruned — they represent active state.
   * Called by aggregatorService on its nightly cycle.
   *
   * @param {number} [retentionDays] — override configured retention
   * @returns {number} — number of rows deleted
   */
  async prune(retentionDays = null) {
    if (!this._initialized) await this.initialize();

    const days = retentionDays ?? this._retentionDays;

    try {
      const [result] = await db.pool.query(
        `DELETE FROM event_log
          WHERE resolved_at IS NOT NULL
            AND timestamp < datetime('now', '-' || ? || ' days')`,
        [days]
      );

      const deleted = result.affectedRows ?? 0;
      if (deleted > 0) {
        console.log(`   • ${PREFIX} - pruned ${deleted} events older than ${days} days`);
      }
      return deleted;
    } catch (err) {
      console.error(`   • ${PREFIX} - prune failed: ${err.message}`);
      return 0;
    }
  }

  // ── Utility ─────────────────────────────────────────────────────────────────

  /** Check if a severity level qualifies as an alert under current config. */
  isAlert(severity) {
    return (SEVERITY_LEVELS[severity] ?? 0) >= (SEVERITY_LEVELS[this._alertThreshold] ?? 0);
  }

  /** Get the configured alert threshold. */
  get alertThreshold() {
    return this._alertThreshold;
  }

  /** Get the configured retention in days. */
  get retentionDays() {
    return this._retentionDays;
  }

  /** Expose severity levels for consumers that need to compare. */
  get severityLevels() {
    return { ...SEVERITY_LEVELS };
  }

  /** Expose valid categories for consumers / validation. */
  get validCategories() {
    return [...VALID_CATEGORIES];
  }
}

export default new EventLogService();