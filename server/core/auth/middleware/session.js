// core/auth/middleware/session.js
//
// Wijzigingen t.o.v. MySQL-versie:
//   express-mysql-session  →  eigen SQLiteStore op basis van db.pool.query shim
//   db.pool                →  db.query (shim exporteert beide)
//
// De SqliteStore implementeert de minimale express-session Store API:
//   get(sid, cb)      — sessie ophalen
//   set(sid, sess, cb)— sessie opslaan / bijwerken
//   destroy(sid, cb)  — sessie verwijderen
//   touch(sid, sess, cb) — vervaltijd verlengen (rolling sessions)
//   clear(cb)         — alle sessies wissen

import session from 'express-session';
import db from '../../database.js';

const SESSION_EXPIRY_MS = 1000 * 60 * 60 * 8; // 8 uur

// ── SQLite session store ──────────────────────────────────────────────────────
//
// express-session verwacht een Store subklasse met callback-gebaseerde methoden.
// Onze db.pool.query shim is Promise-gebaseerd, dus we wikkelen elke methode.
//
// Sessions worden opgeslagen als:
//   session_id  TEXT PRIMARY KEY
//   expires     INTEGER (Unix timestamp in seconden — zelfde als express-mysql-session)
//   data        TEXT (JSON)

class SqliteStore extends session.Store {
  constructor() {
    super();

    // Verwijder verlopen sessies elke 15 minuten
    setInterval(() => this._cleanup(), 900_000).unref();
  }

  // Sessie ophalen
  get(sid, callback) {
    db.pool.query(
      'SELECT data, expires FROM sessions WHERE session_id = ?',
      [sid]
    )
      .then(([rows]) => {
        if (rows.length === 0) return callback(null, null);

        const row = rows[0];

        // Controleer of sessie verlopen is
        if (row.expires < Math.floor(Date.now() / 1000)) {
          this.destroy(sid, () => {});
          return callback(null, null);
        }

        try {
          const sess = JSON.parse(row.data);
          callback(null, sess);
        } catch {
          callback(null, null);
        }
      })
      .catch(err => callback(err));
  }

  // Sessie opslaan of bijwerken
  set(sid, sess, callback) {
    const expires = Math.floor(
      (Date.now() + (sess.cookie?.maxAge || SESSION_EXPIRY_MS)) / 1000
    );

    db.pool.query(
      `INSERT INTO sessions (session_id, expires, data)
       VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         expires = excluded.expires,
         data    = excluded.data`,
      [sid, expires, JSON.stringify(sess)]
    )
      .then(() => callback(null))
      .catch(err => callback(err));
  }

  // Sessie verwijderen
  destroy(sid, callback) {
    db.pool.query('DELETE FROM sessions WHERE session_id = ?', [sid])
      .then(() => callback(null))
      .catch(err => callback(err));
  }

  // Vervaltijd verlengen zonder sessiedata te wijzigen (rolling sessions)
  touch(sid, sess, callback) {
    const expires = Math.floor(
      (Date.now() + (sess.cookie?.maxAge || SESSION_EXPIRY_MS)) / 1000
    );

    db.pool.query(
      'UPDATE sessions SET expires = ? WHERE session_id = ?',
      [expires, sid]
    )
      .then(() => callback(null))
      .catch(err => callback(err));
  }

  // Alle sessies wissen
  clear(callback) {
    db.pool.query('DELETE FROM sessions')
      .then(() => callback(null))
      .catch(err => callback(err));
  }

  // Verlopen sessies opruimen (intern, via interval)
  _cleanup() {
    db.pool.query(
      'DELETE FROM sessions WHERE expires < ?',
      [Math.floor(Date.now() / 1000)]
    ).catch(() => {});
  }
}

// ── Session middleware ────────────────────────────────────────────────────────

export function createSessionMiddleware() {
  const store = new SqliteStore();

  return session({
    key:              'wattson_session_id',
    secret:           process.env.SESSION_SECRET || 'wattson-energy-monitor-change-in-production',
    store,
    resave:           false,  // Niet opslaan als sessie niet gewijzigd is
    saveUninitialized:false,  // Geen sessie aanmaken tot er iets opgeslagen wordt
    rolling:          true,   // Vervaltijd resetten bij elk verzoek
    cookie: {
      maxAge:   SESSION_EXPIRY_MS,
      httpOnly: true,                                       // XSS bescherming
      secure:   process.env.NODE_ENV === 'production',      // HTTPS in productie
      sameSite: 'lax',                                      // CSRF bescherming
      path:     '/',
    },
  });
}

// ── Debug middleware ──────────────────────────────────────────────────────────

export function attachSessionInfo(req, res, next) {
  if (req.session) {
    res.setHeader('X-Session-ID',    req.session.id           || 'none');
    res.setHeader('X-Authenticated', req.session.authenticated ? 'true' : 'false');
  }
  next();
}

// ── Handmatige cleanup ────────────────────────────────────────────────────────
//
// Kan extern worden aangeroepen als dat nodig is.
// result[0].affectedRows werkt correct met de db shim (Pattern B).

export async function cleanupExpiredSessions() {
  try {
    const result = await db.query(
      'DELETE FROM sessions WHERE expires < ?',
      [Math.floor(Date.now() / 1000)]
    );
    console.log(`   - Cleaned up ${result[0].affectedRows} expired sessions`);
  } catch (error) {
    console.error('Error cleaning up sessions:', error);
  }
}