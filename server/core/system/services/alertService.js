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

import db from '../../database.js';

class AlertService {

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
            AND auto_resolved = 0
            AND created_at   >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
          LIMIT 1`,
        [source, alert.type, dedupMinutes]
      );

      if (existing.length > 0) {
        return null; // Already alerted within window
      }

      const [result] = await db.pool.query(
        `INSERT INTO app_alerts
           (source, source_id, type, severity, message, suggestion, action)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
   * @param {number} userId
   * @returns {Array}
   */
  async getActive(userId) {
    const [rows] = await db.pool.query(
      `SELECT
         a.id, a.source, a.source_id, a.type, a.severity,
         a.message, a.suggestion, a.action, a.created_at
       FROM app_alerts a
       LEFT JOIN app_alert_dismissals d
         ON d.alert_id = a.id AND d.user_id = ?
       WHERE a.auto_resolved = 0
         AND d.id IS NULL
       ORDER BY a.created_at DESC
       LIMIT 50`,
      [userId]
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
      `INSERT IGNORE INTO app_alert_dismissals (alert_id, user_id)
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
          SET auto_resolved = 1, resolved_at = NOW()
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
          SET auto_resolved = 1, resolved_at = NOW()
        WHERE source        = ?
          AND type          LIKE ?
          AND auto_resolved = 0`,
      [source, `${typePrefix}%`]
    );
  }
}

export default new AlertService();