// server/tests/services/eventLogService.test.js
//
// Tests for the core event log service.
// Uses an in-memory SQLite database — no file I/O, no cleanup needed.
//
// Run:  npm test
// Watch: npm run test:watch

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../helpers/testDb.js';

// ── Mock database with fresh in-memory SQLite ─────────────────────────────
const testDb = createTestDb();

vi.mock('../../core/database.js', () => ({ default: testDb }));

// Mock the logger utility (avoid importing the full logger chain)
vi.mock('../../core/utils/logger.js', () => ({
  padName: (name) => name.padEnd(24),
}));

// Suppress console output during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

// ── Import the service AFTER mocks are set up ─────────────────────────────
const { default: eventLog } = await import('../../core/system/services/eventLogService.js');

// Initialize the service — creates the event_log table in the test database
await eventLog.initialize();

// ── Helpers ───────────────────────────────────────────────────────────────

/** Clear all rows from event_log between tests */
function clearEvents() {
  testDb.sqlite.exec('DELETE FROM event_log');
  // Reset auto-increment so IDs are predictable (sqlite_sequence may not exist yet)
  try { testDb.sqlite.exec("DELETE FROM sqlite_sequence WHERE name = 'event_log'"); } catch (_) {}
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('eventLogService', () => {

  beforeEach(() => {
    clearEvents();
  });

  // ── log() ───────────────────────────────────────────────────────────────

  describe('log()', () => {
    it('should insert an event and return the row id', async () => {
      const id = await eventLog.log(
        'test:unit', 'system', 'test_event', 'info',
        'Something happened'
      );

      expect(id).toBe(1);

      // Verify it's in the database
      const [rows] = await testDb.query('SELECT * FROM event_log WHERE id = ?', [id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].source).toBe('test:unit');
      expect(rows[0].category).toBe('system');
      expect(rows[0].event).toBe('test_event');
      expect(rows[0].severity).toBe('info');
      expect(rows[0].message).toBe('Something happened');
      expect(rows[0].resolved_at).toBeNull();
    });

    it('should store metadata as JSON', async () => {
      const id = await eventLog.log(
        'test:unit', 'dispatch', 'discharge_started', 'notice',
        'Discharging at 3000W',
        { watts: 3000, soc: 85 }
      );

      const [rows] = await testDb.query('SELECT metadata FROM event_log WHERE id = ?', [id]);
      const meta = JSON.parse(rows[0].metadata);
      expect(meta.watts).toBe(3000);
      expect(meta.soc).toBe(85);
    });

    it('should suppress events below the configured log level', async () => {
      // Default log level is 'info', so 'debug' should be suppressed
      const id = await eventLog.log(
        'test:unit', 'system', 'debug_event', 'debug',
        'Verbose diagnostics'
      );

      expect(id).toBeNull();

      const [rows] = await testDb.query('SELECT * FROM event_log');
      expect(rows).toHaveLength(0);
    });

    it('should default invalid severity to info', async () => {
      const id = await eventLog.log(
        'test:unit', 'system', 'bad_severity', 'banana',
        'Invalid severity test'
      );

      const [rows] = await testDb.query('SELECT severity FROM event_log WHERE id = ?', [id]);
      expect(rows[0].severity).toBe('info');
    });

    it('should store null metadata when none provided', async () => {
      const id = await eventLog.log(
        'test:unit', 'system', 'no_meta', 'info', 'No metadata'
      );

      const [rows] = await testDb.query('SELECT metadata FROM event_log WHERE id = ?', [id]);
      expect(rows[0].metadata).toBeNull();
    });
  });

  // ── resolve() ───────────────────────────────────────────────────────────

  describe('resolve()', () => {
    it('should stamp resolved_at on an active event', async () => {
      const id = await eventLog.log(
        'test:unit', 'dispatch', 'discharge_started', 'notice', 'Active dispatch'
      );

      const resolved = await eventLog.resolve(id);
      expect(resolved).toBe(true);

      const [rows] = await testDb.query('SELECT resolved_at FROM event_log WHERE id = ?', [id]);
      expect(rows[0].resolved_at).not.toBeNull();
    });

    it('should return false for already-resolved events', async () => {
      const id = await eventLog.log(
        'test:unit', 'dispatch', 'discharge_started', 'notice', 'Active dispatch'
      );

      await eventLog.resolve(id);
      const secondResolve = await eventLog.resolve(id);
      expect(secondResolve).toBe(false);
    });

    it('should return false for non-existent ids', async () => {
      const resolved = await eventLog.resolve(99999);
      expect(resolved).toBe(false);
    });
  });

  // ── resolveBySource() ───────────────────────────────────────────────────

  describe('resolveBySource()', () => {
    it('should resolve all active events from a source', async () => {
      await eventLog.log('manual:api', 'dispatch', 'charge_started', 'notice', 'Charge 1');
      await eventLog.log('manual:api', 'dispatch', 'discharge_started', 'notice', 'Discharge 1');
      await eventLog.log('strategy:smart-eco', 'dispatch', 'charge_started', 'notice', 'Strategy charge');

      const count = await eventLog.resolveBySource('manual:api');
      expect(count).toBe(2);

      // Strategy event should still be active
      const active = await eventLog.getActive('info');
      expect(active).toHaveLength(1);
      expect(active[0].source).toBe('strategy:smart-eco');
    });

    it('should filter by event name when provided', async () => {
      await eventLog.log('manual:api', 'dispatch', 'charge_started', 'notice', 'Charge');
      await eventLog.log('manual:api', 'dispatch', 'discharge_started', 'notice', 'Discharge');

      const count = await eventLog.resolveBySource('manual:api', 'charge_started');
      expect(count).toBe(1);

      const active = await eventLog.getActive('info');
      expect(active).toHaveLength(1);
      expect(active[0].event).toBe('discharge_started');
    });
  });

  // ── resolveByCategory() ─────────────────────────────────────────────────

  describe('resolveByCategory()', () => {
    it('should resolve all active events in a category', async () => {
      await eventLog.log('manual:api', 'dispatch', 'charge_started', 'notice', 'Manual');
      await eventLog.log('strategy:smart-eco', 'dispatch', 'discharge_started', 'notice', 'Strategy');
      await eventLog.log('core:system', 'system', 'startup_complete', 'info', 'Started');

      const count = await eventLog.resolveByCategory('dispatch');
      expect(count).toBe(2);

      // System event should still be active
      const [rows] = await testDb.query(
        'SELECT * FROM event_log WHERE resolved_at IS NULL'
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].category).toBe('system');
    });
  });

  // ── getActive() ─────────────────────────────────────────────────────────

  describe('getActive()', () => {
    it('should return only unresolved events above threshold', async () => {
      await eventLog.log('test:a', 'dispatch', 'ev1', 'info', 'Below threshold');
      await eventLog.log('test:b', 'dispatch', 'ev2', 'notice', 'At threshold');
      await eventLog.log('test:c', 'dispatch', 'ev3', 'warning', 'Above threshold');

      // Default threshold is 'notice'
      const active = await eventLog.getActive();
      expect(active).toHaveLength(2);
      expect(active.map(e => e.severity)).toContain('notice');
      expect(active.map(e => e.severity)).toContain('warning');
    });

    it('should exclude resolved events', async () => {
      const id = await eventLog.log('test:a', 'dispatch', 'ev1', 'warning', 'Will be resolved');
      await eventLog.log('test:b', 'dispatch', 'ev2', 'warning', 'Stays active');

      await eventLog.resolve(id);

      const active = await eventLog.getActive();
      expect(active).toHaveLength(1);
      expect(active[0].source).toBe('test:b');
    });

    it('should parse metadata JSON', async () => {
      await eventLog.log('test:a', 'dispatch', 'ev1', 'notice', 'With meta', { watts: 3000 });

      const active = await eventLog.getActive();
      expect(active[0].metadata).toEqual({ watts: 3000 });
    });

    it('should respect custom severity threshold', async () => {
      await eventLog.log('test:a', 'dispatch', 'ev1', 'notice', 'Below custom');
      await eventLog.log('test:b', 'dispatch', 'ev2', 'error', 'Above custom');

      const active = await eventLog.getActive('error');
      expect(active).toHaveLength(1);
      expect(active[0].severity).toBe('error');
    });
  });

  // ── getHistory() ────────────────────────────────────────────────────────

  describe('getHistory()', () => {
    it('should return paginated results with total count', async () => {
      for (let i = 0; i < 10; i++) {
        await eventLog.log('test:unit', 'system', `event_${i}`, 'info', `Event ${i}`);
      }

      const result = await eventLog.getHistory({ limit: 3, offset: 0 });
      expect(result.events).toHaveLength(3);
      expect(result.total).toBe(10);
      expect(result.limit).toBe(3);
      expect(result.offset).toBe(0);
    });

    it('should filter by category', async () => {
      await eventLog.log('test:a', 'dispatch', 'ev1', 'info', 'Dispatch event');
      await eventLog.log('test:b', 'system', 'ev2', 'info', 'System event');

      const result = await eventLog.getHistory({ category: 'dispatch' });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].category).toBe('dispatch');
      expect(result.total).toBe(1);
    });

    it('should filter by source prefix', async () => {
      await eventLog.log('strategy:smart-eco', 'dispatch', 'ev1', 'info', 'Strategy');
      await eventLog.log('manual:api', 'dispatch', 'ev2', 'info', 'Manual');

      const result = await eventLog.getHistory({ source: 'strategy:*' });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].source).toBe('strategy:smart-eco');
    });

    it('should filter by minimum severity', async () => {
      await eventLog.log('test:a', 'system', 'ev1', 'info', 'Low');
      await eventLog.log('test:b', 'system', 'ev2', 'warning', 'Medium');
      await eventLog.log('test:c', 'system', 'ev3', 'error', 'High');

      const result = await eventLog.getHistory({ severity: 'warning' });
      expect(result.events).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should cap limit at MAX_HISTORY_LIMIT', async () => {
      const result = await eventLog.getHistory({ limit: 9999 });
      expect(result.limit).toBe(500);
    });
  });

  // ── prune() ─────────────────────────────────────────────────────────────

  describe('prune()', () => {
    it('should delete resolved events older than retention period', async () => {
      // Insert an old resolved event directly
      testDb.sqlite.exec(`
        INSERT INTO event_log (timestamp, source, category, event, severity, message, resolved_at)
        VALUES ('2025-01-01 00:00:00', 'test:old', 'system', 'old_event', 'info', 'Ancient', '2025-01-01 01:00:00')
      `);

      // Insert a recent resolved event
      const recentId = await eventLog.log('test:recent', 'system', 'recent_event', 'info', 'Recent');
      await eventLog.resolve(recentId);

      // Insert an unresolved event (should never be pruned regardless of age)
      testDb.sqlite.exec(`
        INSERT INTO event_log (timestamp, source, category, event, severity, message)
        VALUES ('2025-01-01 00:00:00', 'test:active', 'dispatch', 'active_event', 'warning', 'Still active')
      `);

      const deleted = await eventLog.prune(180);
      expect(deleted).toBe(1); // only the old resolved event

      const [remaining] = await testDb.query('SELECT * FROM event_log');
      expect(remaining).toHaveLength(2); // recent resolved + old unresolved
    });

    it('should never prune unresolved events', async () => {
      testDb.sqlite.exec(`
        INSERT INTO event_log (timestamp, source, category, event, severity, message)
        VALUES ('2020-01-01 00:00:00', 'test:ancient', 'dispatch', 'stuck', 'warning', 'Very old but still active')
      `);

      const deleted = await eventLog.prune(1);
      expect(deleted).toBe(0);

      const [rows] = await testDb.query('SELECT * FROM event_log');
      expect(rows).toHaveLength(1);
    });
  });

  // ── isAlert() ───────────────────────────────────────────────────────────

  describe('isAlert()', () => {
    it('should return true for severity at or above threshold', () => {
      // Default threshold is 'notice'
      expect(eventLog.isAlert('notice')).toBe(true);
      expect(eventLog.isAlert('warning')).toBe(true);
      expect(eventLog.isAlert('error')).toBe(true);
      expect(eventLog.isAlert('critical')).toBe(true);
    });

    it('should return false for severity below threshold', () => {
      expect(eventLog.isAlert('debug')).toBe(false);
      expect(eventLog.isAlert('info')).toBe(false);
    });
  });

  // ── Dispatch lifecycle (integration) ────────────────────────────────────

  describe('dispatch lifecycle', () => {
    it('should track a full dispatch: start → active alert → resolve → history', async () => {
      // 1. Start a discharge
      const id = await eventLog.log(
        'manual:api', 'dispatch', 'discharge_started', 'notice',
        'Discharge at 3000W', { watts: 3000, minimumSOC: 20 }
      );
      expect(id).toBeGreaterThan(0);

      // 2. Should appear as active alert
      const active = await eventLog.getActive();
      expect(active).toHaveLength(1);
      expect(active[0].event).toBe('discharge_started');
      expect(active[0].metadata.watts).toBe(3000);

      // 3. Stop the dispatch — resolve + log stop event
      await eventLog.resolveByCategory('dispatch');
      await eventLog.log(
        'manual:api', 'dispatch', 'dispatch_stopped', 'info',
        'Dispatch stopped'
      );

      // 4. No more active alerts (stop is 'info', below 'notice' threshold)
      const activeAfter = await eventLog.getActive();
      expect(activeAfter).toHaveLength(0);

      // 5. Full history shows both events
      const history = await eventLog.getHistory({ category: 'dispatch' });
      expect(history.total).toBe(2);
      const events = history.events.map(e => e.event).sort();
      expect(events).toEqual(['discharge_started', 'dispatch_stopped']);

      // The started event should be resolved
      const started = history.events.find(e => e.event === 'discharge_started');
      expect(started.resolved_at).not.toBeNull();
    });
  });
});