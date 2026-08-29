// core/system/services/alertService.js
//
// Generic alert service for the app_alerts + app_alert_dismissals tables.
//
// Usage (from any module):
//   import alertService from './alertService.js';
//
//   await alertService.write('strategy', 'smart-eco', {
//     type:       'solar_curtailment_risk_80',
//     severity:   'warning',
//     message:    'Battery at 83% with solar incoming...',
//     suggestion: 'Run high-load appliances now.',
//     action:     null,
//   });
//
//   const alerts = await alertService.getActive(userId);
//   await alertService.dismiss(alertId, userId);
//   await alertService.resolve(alertId);           // global, admin-only
//
// Confirm/decline (added for held dispatch actions — see strategyManager's
// load-anomaly and UPS-mode gates):
//   const alertId = await alertService.write(...);
//   ...
//   await alertService.respond(alertId, userId, 'confirmed');
//   const response = await alertService.getResponse(alertId); // 'confirmed' | 'declined' | null
//
// getActive() includes each alert's user_response (null while pending) so
// the frontend can render "already responded" state immediately on load,
// not just after the user clicks something in the current session.
//
// Events:
//   Emits 'alert' with { id, source, sourceId, type, severity, message,
//   suggestion, action } whenever a NEW alert is written (not on dedup-skip).
//   Consumers (e.g. the push module) subscribe via alertService.on('alert', ...).
//   This service has no knowledge of what listens — keeps it decoupled from
//   any specific notification mechanism.

import db from '../../database.js';
import { EventEmitter } from 'events';

class AlertService extends EventEmitter {

  /**
   * Write an alert, deduplicating by (source, type) within `dedupMinutes`.
   * If an identical unresolved alert already exists within the window, skip.
   *
   * @param {string} source          - e.g. 'strategy', 'collector', 'hardware'
   * @param {string|null} sourceId   - e.g. 'smart-eco', 'alpha-ess-modbus'
   * @param {object} alert           - { type, severity, message, suggestion, action }
   * @param {number} dedupMinutes    - dedup window in minutes (default 60)
   * @returns {number|null}          - inserted alert id, or null if deduped
   */
  async write(source, sourceId, alert, dedupMinutes = 60) {
    try {
      const [existing] = await db.pool.query(
        `SELECT id FROM app_alerts
          WHERE source        = ?
            AND type          = ?
            AND (auto_resolved = 0 OR auto_resolved IS NULL)
            AND created_at   >= datetime('now', '-' || ? || ' minutes')
          LIMIT 1`,
        [source, alert.type, dedupMinutes]
      );

      if (existing.length > 0) {
        return null; // Already alerted within window
      }

      const [result] = await db.pool.query(
        `INSERT INTO app_alerts
           (source, source_id, type, severity, message, suggestion, action, auto_resolved, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
        [
          source,
          sourceId ?? null,
          alert.type,
          alert.severity ?? 'info',
          alert.message,
          alert.suggestion ?? null,
          alert.action     ?? null,
        ]
      );

      console.log(`   • AlertService [${alert.severity ?? 'info'}] ${source}/${alert.type}`);

      // Notify listeners (e.g. push module) — fire-and-forget, never throws.
      // `summary` is optional and push-only: a short, notification-friendly
      // version of the alert. Not persisted to app_alerts — the dashboard
      // keeps showing the full `message`. Falls back to `message` for any
      // caller that doesn't set it (push module truncates as a backstop).
      this.emit('alert', {
        id:         result.insertId,
        source,
        sourceId:   sourceId ?? null,
        type:       alert.type,
        severity:   alert.severity ?? 'info',
        message:    alert.message,
        summary:    alert.summary ?? null,
        suggestion: alert.suggestion ?? null,
        action:     alert.action ?? null,
      });

      return result.insertId;

    } catch (e) {
      console.error('   • AlertService write failed:', e.message);
      return null;
    }
  }

  /**
   * Return all unresolved alerts not dismissed by the given user.
   * Newest first. Limited to 50.
   *
   * Includes `user_response` ('confirmed' | 'declined' | null) for alerts
   * awaiting an explicit answer — null means still pending.
   *
   * @param {number} userId
   * @returns {Array}
   */
  async getActive(userId) {
    await this._ensureResponseTable();
    const [rows] = await db.pool.query(
      `SELECT
         a.id, a.source, a.source_id, a.type, a.severity,
         a.message, a.suggestion, a.action, a.created_at,
         r.response AS user_response
       FROM app_alerts a
       LEFT JOIN app_alert_dismissals d
         ON d.alert_id = a.id AND d.user_id = ?
       LEFT JOIN app_alert_responses r
         ON r.alert_id = a.id AND r.user_id = ?
       WHERE (a.auto_resolved = 0 OR a.auto_resolved IS NULL)
         AND d.id IS NULL
       ORDER BY a.created_at DESC
       LIMIT 50`,
      [userId, userId]
    );
    return rows;
  }

  /**
   * Dismiss an alert for a specific user only.
   * Other users continue to see the alert.
   *
   * @param {number} alertId
   * @param {number} userId
   */
  async dismiss(alertId, userId) {
    await db.pool.query(
      `INSERT OR IGNORE INTO app_alert_dismissals (alert_id, user_id)
       VALUES (?, ?)`,
      [alertId, userId]
    );
  }

  /**
   * Globally resolve an alert (admin action).
   * Marks it resolved for all users.
   *
   * @param {number} alertId
   */
  async resolve(alertId) {
    await db.pool.query(
      `UPDATE app_alerts
          SET auto_resolved = 1, resolved_at = datetime('now')
        WHERE id = ?`,
      [alertId]
    );
  }

  /**
   * Auto-resolve all unresolved alerts of a given type from a source.
   * Useful when a condition clears (e.g. SoC drops below trigger).
   *
   * @param {string} source
   * @param {string} typePrefix  - resolves all types starting with this prefix
   */
  async resolveByTypePrefix(source, typePrefix) {
    await db.pool.query(
      `UPDATE app_alerts
          SET auto_resolved = 1, resolved_at = datetime('now')
        WHERE source        = ?
          AND type          LIKE ?
          AND (auto_resolved = 0 OR auto_resolved IS NULL)`,
      [source, `${typePrefix}%`]
    );
  }

  // ── Confirm / decline ───────────────────────────────────────────────────────

  async _ensureResponseTable() {
    if (this._responseTableReady) return;
    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS app_alert_responses (
        alert_id     INTEGER NOT NULL,
        user_id      INTEGER NOT NULL,
        response     TEXT    NOT NULL CHECK (response IN ('confirmed', 'declined')),
        responded_at TEXT    NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (alert_id, user_id)
      )
    `);
    this._responseTableReady = true;
  }

  async respond(alertId, userId, response) {
    if (response !== 'confirmed' && response !== 'declined') {
      throw new Error(`Invalid response '${response}' — must be 'confirmed' or 'declined'`);
    }
    await this._ensureResponseTable();
    await db.pool.query(
      `INSERT INTO app_alert_responses (alert_id, user_id, response, responded_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(alert_id, user_id) DO UPDATE SET
         response     = excluded.response,
         responded_at = excluded.responded_at`,
      [alertId, userId, response]
    );
    console.log(`   • AlertService - alert #${alertId} ${response} by user ${userId}`);
  }

  async getResponse(alertId) {
    await this._ensureResponseTable();
    const [rows] = await db.pool.query(
      `SELECT response FROM app_alert_responses
        WHERE alert_id = ?
        ORDER BY responded_at DESC
        LIMIT 1`,
      [alertId]
    );
    return rows[0]?.response ?? null;
  }
}

export default new AlertService();