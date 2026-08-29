// modules/push-notifications/services/sender.js
//
// Sends Web Push notifications to all stored subscriptions.
// Self-initializes its own table — same pattern as alertService's
// app_alert_responses table. No separate migration file needed.

import db from '../../../core/database.js';

class PushSender {
  constructor() {
    this._tableReady = false;
    this._webpush   = null;
    this.lastSent   = null;
    this.lastError  = null;
  }

  configure(webpushInstance) {
    this._webpush = webpushInstance;
  }

  async ensureTable() {
    if (this._tableReady) return;
    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint   TEXT NOT NULL UNIQUE,
        p256dh     TEXT NOT NULL,
        auth       TEXT NOT NULL,
        label      TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this._tableReady = true;
  }

  async subscribe(subscription, label = null) {
    await this.ensureTable();
    const { endpoint, keys } = subscription;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      throw new Error('Invalid push subscription payload');
    }
    await db.pool.query(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, label, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth   = excluded.auth,
         label  = excluded.label`,
      [endpoint, keys.p256dh, keys.auth, label]
    );
  }

  async unsubscribe(endpoint) {
    await this.ensureTable();
    await db.pool.query(`DELETE FROM push_subscriptions WHERE endpoint = ?`, [endpoint]);
  }

  async getSubscriptionCount() {
    await this.ensureTable();
    const [rows] = await db.pool.query(`SELECT COUNT(*) AS n FROM push_subscriptions`);
    return rows[0]?.n ?? 0;
  }

  async sendToAll(payload) {
    await this.ensureTable();
    if (!this._webpush) {
      this.lastError = 'web-push not configured (VAPID keys missing?)';
      return;
    }

    const [rows] = await db.pool.query(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions`);
    if (rows.length === 0) return;

    const body = JSON.stringify(payload);

    await Promise.all(rows.map(async (row) => {
      const subscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
      try {
        await this._webpush.sendNotification(subscription, body);
        this.lastSent = new Date().toISOString();
      } catch (err) {
        // 404/410 = subscription is gone (uninstalled, browser data cleared, etc.) — prune it
        if (err.statusCode === 404 || err.statusCode === 410) {
          await db.pool.query(`DELETE FROM push_subscriptions WHERE id = ?`, [row.id]);
          console.log(`   • Push: pruned dead subscription #${row.id}`);
        } else {
          this.lastError = err.message;
          console.error(`   • Push: send failed for subscription #${row.id} — ${err.message}`);
        }
      }
    }));
  }
}

export default new PushSender();