// core/system/routes/logs.js
//
// Raw log file API — read the daily console/log files written by
// systemLogger.js (see server.js: `import './systemLogger.js'`), with
// datetime-cursor pagination for scroll-to-load-more in the frontend.
//
// This is deliberately unfiltered and unstructured — it's a debugging tool,
// not the curated event feed (see events.js / eventLogService for that).
// No level filtering, no module filtering: raw lines, newest first, paged
// by timestamp cursor.
//
// Endpoints:
//   GET    /api/logs               — last N lines (default 100), or N lines before a cursor
//   GET    /api/logs/marks         — all currently-marked entries (no file I/O)
//   POST   /api/logs/marks/toggle  — mark/unmark a single entry
//   DELETE /api/logs/marks         — remove all marks
//
// Marks: a "flag for later" facility, independent of the log files themselves.
// Marks persist for LOG_MARKS_RETENTION_DAYS (30d) — deliberately longer than
// the log files' own retention (21d, per the startup banner), so the FULL
// entry (timestamp/level/message) is stored at mark-time rather than just a
// reference — otherwise a mark could outlive the file it points to and
// silently go stale in its last ~9 days.
//
// Requires (run once, wherever other tables are initialized):
//   CREATE TABLE IF NOT EXISTS log_marks (
//     log_timestamp TEXT PRIMARY KEY,
//     level         TEXT NOT NULL,
//     message       TEXT NOT NULL,
//     marked_at     TEXT NOT NULL
//   );
//
// Mounted in server.js:
//   import logsRoutes from './core/system/routes/logs.js';
//   app.use('/api/logs', logsRoutes);
//
// ── ASSUMPTIONS NOT YET VERIFIED AGAINST systemLogger.js ───────────────────
// This constant is isolated here specifically so it's a one-line fix if the
// assumption turns out wrong:
//
//   LOG_DIR  — assumed <project-root>/logs (relative to process cwd).
//              Confirmed path was "/server/logs"; adjust if pm2's cwd isn't
//              the server root.
//
// CONFIRMED: the daily file rolls over at UTC midnight, not local midnight
// (despite the startup banner displaying local time for humans). Filename
// generation and day-stepping below both use UTC date components
// accordingly — do not switch these to local-time Date methods.

import express from 'express';
import fs      from 'fs/promises';
import path    from 'path';

const router = express.Router();

const LOG_DIR             = path.join(process.cwd(), 'logs');
const FILENAME_PREFIX     = 'wolffie-';
const MAX_LIMIT           = 500;
const DEFAULT_LIMIT       = 100;
const MAX_DAYS_LOOKBACK   = 25; // slightly beyond the 21-day retention as a safety margin
const LOG_MARKS_RETENTION_DAYS = 30;

// Matches the same `(await import(...)).default` pattern used in
// core/system/routes/strategies.js, for consistency with the rest of the
// project rather than introducing a top-level import convention here.
async function getDb() {
  return (await import('../../database.js')).default;
}

// Matches: [2026-07-17T06:03:54.168Z] [INFO ] message text...
const LINE_PATTERN = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]\s*\[(\w+)\s*\]\s*(.*)$/;

// Strips ANSI color/style escape codes (e.g. \x1b[32m) for clean display.
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * Builds the daily log filename for a given Date, using UTC date
 * components (confirmed: the file rolls over at UTC midnight).
 */
function getLogFilename(date) {
  const yyyy = date.getUTCFullYear();
  const mm   = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(date.getUTCDate()).padStart(2, '0');
  return `${FILENAME_PREFIX}${yyyy}-${mm}-${dd}.log`;
}

/**
 * Reads and parses one day's log file into an array of entries, oldest
 * first (matches on-disk order). Returns [] if the file doesn't exist.
 * Lines that don't match the [timestamp] [LEVEL] prefix (e.g. stack trace
 * continuation lines) are appended to the previous entry's message rather
 * than dropped or treated as their own dateless entry.
 */
async function readDayFile(date) {
  const filePath = path.join(LOG_DIR, getLogFilename(date));

  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const entries = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;

    const clean = line.replace(ANSI_PATTERN, '');
    const match = clean.match(LINE_PATTERN);

    if (match) {
      const [, timestamp, level, message] = match;
      entries.push({ timestamp, level: level.trim(), message });
    } else if (entries.length > 0) {
      // Continuation line (e.g. a multi-line stack trace) — attach to the
      // previous entry rather than lose it or treat it as a new one.
      entries[entries.length - 1].message += '\n' + clean;
    }
    // else: orphaned line before any parsed entry — nothing sensible to
    // attach it to, so it's dropped.
  }

  return entries;
}

/**
 * Deletes marks older than LOG_MARKS_RETENTION_DAYS. Called lazily at the
 * start of any route that touches log_marks — no separate scheduled job.
 */
async function purgeStaleMarks(db) {
  await db.pool.query(
    `DELETE FROM log_marks WHERE marked_at < datetime('now', ?)`,
    [`-${LOG_MARKS_RETENTION_DAYS} days`]
  );
}

/**
 * Returns a Set of currently-marked timestamps, after purging stale ones.
 */
async function getMarkedTimestampSet(db) {
  await purgeStaleMarks(db);
  const [rows] = await db.pool.query(`SELECT log_timestamp FROM log_marks`);
  return new Set(rows.map(r => r.log_timestamp));
}

/**
 * GET /api/logs
 *
 * Query params:
 *   before  — ISO datetime cursor; returns entries strictly older than this.
 *             Omit to get the most recent entries.
 *   limit   — page size (default 100, max 500)
 *
 * Response:
 *   {
 *     success: true,
 *     entries: [{ timestamp, level, message }, ...],  // newest first
 *     hasMore: boolean,
 *     oldestCursor: string | null   // pass as `before` to fetch the next page
 *   }
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(
      parseInt(req.query.limit, 10) || DEFAULT_LIMIT,
      MAX_LIMIT
    );
    const before = req.query.before ? new Date(req.query.before) : null;
    if (before && isNaN(before.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid `before` datetime' });
    }

    const collected = []; // newest first, across however many day-files we need
    let cursorDate = before ?? new Date();
    let daysWalked = 0;
    let hasMore = false;

    while (collected.length < limit && daysWalked < MAX_DAYS_LOOKBACK) {
      const dayEntries = await readDayFile(cursorDate); // oldest first

      // Only entries strictly older than the cursor (avoids re-returning
      // the boundary entry on the next page).
      const eligible = before
        ? dayEntries.filter(e => new Date(e.timestamp) < before)
        : dayEntries;

      // Walk this day's entries newest-first.
      for (let i = eligible.length - 1; i >= 0; i--) {
        if (collected.length >= limit) {
          hasMore = true;
          break;
        }
        collected.push(eligible[i]);
      }

      // Move to the previous UTC calendar day for the next iteration
      // (log files roll over at UTC midnight, not local midnight).
      cursorDate = new Date(cursorDate);
      cursorDate.setUTCDate(cursorDate.getUTCDate() - 1);
      cursorDate.setUTCHours(23, 59, 59, 999); // land inside the prior UTC day
      daysWalked++;
    }

    const oldestCursor = collected.length > 0
      ? collected[collected.length - 1].timestamp
      : null;

    const db = await getDb();
    const markedSet = await getMarkedTimestampSet(db);
    const entriesWithMarks = collected.map(e => ({
      ...e,
      marked: markedSet.has(e.timestamp),
    }));

    res.json({
      success:  true,
      entries:  entriesWithMarks,
      hasMore,
      oldestCursor,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/logs/marks
 *
 * All currently-marked entries, read directly from log_marks — no file
 * access, so this works even if the source log file has since rotated out.
 *
 * Response: { success: true, entries: [{ timestamp, level, message, markedAt }] }
 * (newest first)
 */
router.get('/marks', async (req, res) => {
  try {
    const db = await getDb();
    await purgeStaleMarks(db);

    const [rows] = await db.pool.query(
      `SELECT log_timestamp AS timestamp, level, message, marked_at AS markedAt
       FROM log_marks
       ORDER BY log_timestamp DESC`
    );

    res.json({ success: true, entries: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/logs/marks/toggle
 *
 * Body: { timestamp, level, message }
 * Marks the entry if not already marked; unmarks it if it is — a single
 * click/action toggles state either way.
 *
 * Response: { success: true, marked: boolean }
 */
router.post('/marks/toggle', async (req, res) => {
  try {
    const { timestamp, level, message } = req.body ?? {};
    if (!timestamp) {
      return res.status(400).json({ success: false, error: 'timestamp is required' });
    }

    const db = await getDb();
    await purgeStaleMarks(db);

    const [existing] = await db.pool.query(
      `SELECT log_timestamp FROM log_marks WHERE log_timestamp = ?`,
      [timestamp]
    );

    if (existing.length > 0) {
      await db.pool.query(`DELETE FROM log_marks WHERE log_timestamp = ?`, [timestamp]);
      return res.json({ success: true, marked: false });
    }

    await db.pool.query(
      `INSERT INTO log_marks (log_timestamp, level, message, marked_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [timestamp, level ?? '', message ?? '']
    );
    res.json({ success: true, marked: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/logs/marks
 *
 * Removes all marks unconditionally (the "clear all" action).
 */
router.delete('/marks', async (req, res) => {
  try {
    const db = await getDb();
    await db.pool.query(`DELETE FROM log_marks`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;