// server/tests/services/alertService.test.js
//
// Tests for alertService — write/dedupe/dismiss/resolve, and the 'alert'
// EventEmitter added for the push-notifications module.
//
// app_alerts / app_alert_dismissals have no self-init CREATE TABLE in
// alertService itself (unlike app_alert_responses), so this file creates
// that schema manually against the in-memory test DB.
//
// Run:  npm test
// Watch: npm run test:watch

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../helpers/testDb.js';

const testDb = createTestDb();

vi.mock('../../core/database.js', () => ({ default: testDb }));

vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

const { default: alertService } = await import('../../core/system/services/alertService.js');

function createSchema() {
  testDb.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_alerts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      source        TEXT NOT NULL,
      source_id     TEXT,
      type          TEXT NOT NULL,
      severity      TEXT NOT NULL DEFAULT 'info',
      message       TEXT NOT NULL,
      suggestion    TEXT,
      action        TEXT,
      auto_resolved INTEGER DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at   TEXT
    )
  `);
  testDb.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_alert_dismissals (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER NOT NULL,
      user_id  INTEGER NOT NULL,
      UNIQUE(alert_id, user_id)
    )
  `);
}

function clearAlerts() {
  testDb.sqlite.exec('DELETE FROM app_alerts');
  testDb.sqlite.exec('DELETE FROM app_alert_dismissals');
  try { testDb.sqlite.exec("DELETE FROM sqlite_sequence WHERE name IN ('app_alerts','app_alert_dismissals')"); } catch (_) {}
}

describe('alertService', () => {

  beforeEach(() => {
    createSchema();
    clearAlerts();
    alertService.removeAllListeners('alert');
  });

  // ── write() ─────────────────────────────────────────────────────────────

  describe('write()', () => {
    it('should insert an alert and return its id', async () => {
      const id = await alertService.write('strategy', 'smart-eco', {
        type: 'solar_curtailment_risk_80',
        severity: 'warning',
        message: 'Battery at 83% with solar incoming',
        suggestion: 'Run high-load appliances now.',
        action: null,
      });

      expect(id).toBe(1);

      const [rows] = await testDb.query('SELECT * FROM app_alerts WHERE id = ?', [id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].source).toBe('strategy');
      expect(rows[0].source_id).toBe('smart-eco');
      expect(rows[0].severity).toBe('warning');
    });

    it('should dedupe identical (source, type) within the window', async () => {
      const first = await alertService.write('strategy', 'smart-eco',
        { type: 'dup_test', severity: 'info', message: 'first' });
      const second = await alertService.write('strategy', 'smart-eco',
        { type: 'dup_test', severity: 'info', message: 'second' });

      expect(first).not.toBeNull();
      expect(second).toBeNull();

      const [rows] = await testDb.query('SELECT * FROM app_alerts');
      expect(rows).toHaveLength(1);
    });

    it('should default severity to info when not provided', async () => {
      const id = await alertService.write('collector', 'alpha-ess-modbus',
        { type: 'no_severity', message: 'test' });

      const [rows] = await testDb.query('SELECT severity FROM app_alerts WHERE id = ?', [id]);
      expect(rows[0].severity).toBe('info');
    });

    it('should return null and not throw on a DB failure', async () => {
      const id = await alertService.write('strategy', 'smart-eco', {
        // Missing required 'type' — will violate the write query's expectations
        // via a forced table drop below, simulating a hard failure.
        type: 'will_fail', severity: 'info', message: 'test',
      });
      expect(id).not.toBeNull(); // sanity: normal path still works

      testDb.sqlite.exec('DROP TABLE app_alerts');
      const failedId = await alertService.write('strategy', 'smart-eco',
        { type: 'after_drop', severity: 'info', message: 'test' });
      expect(failedId).toBeNull();

      createSchema(); // restore for subsequent tests
    });
  });

  // ── 'alert' event emission ─────────────────────────────────────────────────

  describe('alert event', () => {
    it('should emit "alert" with the full alert payload on a new write', async () => {
      const listener = vi.fn();
      alertService.on('alert', listener);

      const id = await alertService.write('strategy', 'smart-eco', {
        type: 'battery_full',
        severity: 'notice',
        message: 'Battery reached 100%',
        suggestion: 'None needed.',
        action: null,
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({
        id,
        source: 'strategy',
        sourceId: 'smart-eco',
        type: 'battery_full',
        severity: 'notice',
        message: 'Battery reached 100%',
        suggestion: 'None needed.',
        action: null,
      });
    });

    it('should NOT emit "alert" when a write is deduped', async () => {
      const listener = vi.fn();

      await alertService.write('strategy', 'smart-eco',
        { type: 'dedupe_emit_test', severity: 'info', message: 'first' });

      alertService.on('alert', listener);
      const second = await alertService.write('strategy', 'smart-eco',
        { type: 'dedupe_emit_test', severity: 'info', message: 'second' });

      expect(second).toBeNull();
      expect(listener).not.toHaveBeenCalled();
    });

    it('should default sourceId to null in the emitted payload when omitted', async () => {
      const listener = vi.fn();
      alertService.on('alert', listener);

      await alertService.write('collector', null,
        { type: 'no_source_id', severity: 'error', message: 'Connection lost' });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: null, severity: 'error' })
      );
    });

    it('should support multiple independent listeners', async () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();
      alertService.on('alert', listenerA);
      alertService.on('alert', listenerB);

      await alertService.write('strategy', 'smart-eco',
        { type: 'multi_listener_test', severity: 'warning', message: 'test' });

      expect(listenerA).toHaveBeenCalledTimes(1);
      expect(listenerB).toHaveBeenCalledTimes(1);
    });
  });

  // ── getActive() / dismiss() (regression coverage) ───────────────────────────

  describe('getActive() and dismiss()', () => {
    it('should exclude alerts dismissed by the requesting user', async () => {
      const id = await alertService.write('strategy', 'smart-eco',
        { type: 'dismiss_test', severity: 'warning', message: 'test' });

      let active = await alertService.getActive(1);
      expect(active).toHaveLength(1);

      await alertService.dismiss(id, 1);

      active = await alertService.getActive(1);
      expect(active).toHaveLength(0);

      // Other users should still see it
      const otherUserActive = await alertService.getActive(2);
      expect(otherUserActive).toHaveLength(1);
    });
  });

  describe('resolve()', () => {
    it('should mark an alert auto_resolved and exclude it from getActive for all users', async () => {
      const id = await alertService.write('strategy', 'smart-eco',
        { type: 'resolve_test', severity: 'warning', message: 'test' });

      await alertService.resolve(id);

      const active = await alertService.getActive(1);
      expect(active).toHaveLength(0);
    });
  });
});