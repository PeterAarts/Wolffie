// server/core/database.js
//
// SQLite wrapper —
// Bij eerste opstart met lege database wordt schema.sql automatisch uitgevoerd.

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Database pad ──────────────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH
  || path.join(__dirname, '../../data/wolffie.db');

// Zorg dat de map bestaat
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// ── Verbinding openen ─────────────────────────────────────────────────────────
let sqlite;
try {
  sqlite = new Database(DB_PATH);
} catch (err) {
  console.error('❌ SQLite kon niet worden geopend:', DB_PATH, err.message);
  process.exit(1);
}

// ── Pragma's ──────────────────────────────────────────────────────────────────
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('busy_timeout = 5000');

console.log(` - SQLite database: ${DB_PATH}`);

// ── Automatische schema-initialisatie ─────────────────────────────────────────
//
// Controleer of de database leeg is (geen tabellen). Als dat het geval is,
// voer dan schema.sql uit. Dit zorgt voor een correcte fresh install zonder
// handmatige stappen.
//
// schema.sql staat naast database.js in server/core/
// én wordt gekopieerd naar de Docker image via de Dockerfile COPY server/ stap.

const tableCount = sqlite
  .prepare("SELECT COUNT(*) as n FROM sqlite_master WHERE type='table'")
  .get();

if (tableCount.n === 0) {
  console.log(' - Lege database gedetecteerd — schema initialiseren...');

  const schemaPath = path.join(__dirname, '../config/schema.sql');

  if (!fs.existsSync(schemaPath)) {
    console.error('❌ schema.sql niet gevonden op:', schemaPath);
    process.exit(1);
  }

  const schema = fs.readFileSync(schemaPath, 'utf8');

  try {
    sqlite.exec(schema);
    console.log(' - \x1b[32mSchema succesvol aangemaakt\x1b[37m');
  } catch (err) {
    console.error('❌ Schema initialisatie mislukt:', err.message);
    process.exit(1);
  }
} else {
  console.log(` - \x1b[32m${tableCount.n} tabellen gevonden\x1b[37m`);
}

// ── Query shim ────────────────────────────────────────────────────────────────
function query(sql, params = []) {
  try {
    const flat = Array.isArray(params) ? params.flat(1) : [params];
    const stmt = sqlite.prepare(sql);

    if (stmt.reader) {
      return Promise.resolve([ stmt.all(...flat) ]);
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

// ── Transactie helper ─────────────────────────────────────────────────────────
function transaction(fn) {
  try {
    const run = sqlite.transaction(() => { fn(); });
    run();
    return Promise.resolve();
  } catch (err) {
    return Promise.reject(err);
  }
}

export default {
  pool: { query },
  query,
  transaction,
  sqlite,
};