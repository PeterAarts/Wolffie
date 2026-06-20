// server/tests/helpers/testDb.js
//
// Creates a fresh in-memory SQLite database with the same interface as
// core/database.js. Each call returns an isolated database — no shared
// state between tests.
//
// Usage in tests:
//   import { createTestDb } from '../helpers/testDb.js';
//   const testDb = createTestDb();

import Database from 'better-sqlite3';

/**
 * Create a fresh in-memory SQLite database with the query shim
 * that matches core/database.js's interface.
 *
 * Optionally seeds common tables (system_settings) needed by most services.
 */
export function createTestDb({ seedSettings = true } = {}) {
  const sqlite = new Database(':memory:');

  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Seed the tables that most services expect to exist
  if (seedSettings) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        category      TEXT    NOT NULL,
        setting_key   TEXT    NOT NULL,
        setting_value TEXT,
        module_id     TEXT,
        UNIQUE(category, setting_key, module_id)
      )
    `);
  }

  // ── Query shim (same as database.js) ────────────────────────────────────
  function query(sql, params = []) {
    try {
      const flat = Array.isArray(params) ? params.flat(1) : [params];
      const stmt = sqlite.prepare(sql);

      if (stmt.reader) {
        return Promise.resolve([stmt.all(...flat)]);
      } else {
        const info = stmt.run(...flat);
        return Promise.resolve([{
          insertId:     info.lastInsertRowid,
          affectedRows: info.changes,
        }]);
      }
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function transaction(fn) {
    try {
      const run = sqlite.transaction(() => { fn(); });
      run();
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }

  return {
    pool: { query },
    query,
    transaction,
    sqlite,
  };
}