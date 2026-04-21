// systemLogger.js - Global logging with daily rotation and auto-cleanup
// Import this ONCE at the very top of server.js (before anything else)
// It intercepts all console.log/warn/error calls across the entire application.
//
// Usage in server.js:
//   import './systemLogger.js';   // ← first import, before all others
//   import dotenv from 'dotenv';
//   dotenv.config();              // ← dotenv can load AFTER, env is read lazily
//
// Log files are written to: ./logs/wolffie-YYYY-MM-DD.log
// Old files are automatically deleted after LOG_RETENTION_DAYS (default: 21)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Constants (safe to resolve at import time) ───────────────────────────────

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, 'logs');

// ─── Always create the logs folder ───────────────────────────────────────────
// Done unconditionally so it's ready regardless of when dotenv loads.

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// ─── Lazy env helpers ─────────────────────────────────────────────────────────
// These are functions, not constants — they read process.env at call time,
// so dotenv.config() in server.js will already have run by then.

const isProduction  = () => process.env.NODE_ENV === 'production';
const logToFile     = () => isProduction() || process.env.LOG_TO_FILE === 'true';
const retentionDays = () => parseInt(process.env.LOG_RETENTION_DAYS || '21', 10);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayLogPath() {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(LOG_DIR, `wolffie-${date}.log`);
}

function formatLine(level, args) {
  const ts  = new Date().toISOString();
  const msg = args
    .map(a => (typeof a === 'object' ? JSON.stringify(a, null, 0) : String(a)))
    .join(' ');
  return `[${ts}] [${level}] ${msg}\n`;
}

function writeToFile(line) {
  try {
    fs.appendFileSync(todayLogPath(), line, 'utf8');
  } catch {
    // Never let a logging failure crash the server
  }
}

// ─── Old log cleanup ──────────────────────────────────────────────────────────

function cleanOldLogs() {
  if (!logToFile()) return;  // lazy — evaluated at runtime

  try {
    const files  = fs.readdirSync(LOG_DIR);
    const cutoff = Date.now() - retentionDays() * 24 * 60 * 60 * 1000;

    let removed = 0;
    for (const file of files) {
      if (!file.startsWith('wolffie-') || !file.endsWith('.log')) continue;
      const filePath = path.join(LOG_DIR, file);
      const stat     = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        removed++;
      }
    }

    if (removed > 0) {
      writeToFile(formatLine('INFO ', [`Removed ${removed} log file(s) older than ${retentionDays()} days`]));
      originalConsole.log(`Log cleanup: removed ${removed} old file(s)`);
    }
  } catch (err) {
    originalConsole.error('Log cleanup error:', err.message);
  }
}

// ─── Console override ─────────────────────────────────────────────────────────
// Preserve originals for direct stdout/stderr access.

const originalConsole = {
  log:   console.log.bind(console),
  warn:  console.warn.bind(console),
  error: console.error.bind(console),
  info:  console.info.bind(console),
  debug: console.debug.bind(console),
};

// Each override checks logToFile() lazily at call time — so the first
// console.log that fires (even from dotenv itself) will already see the
// correct NODE_ENV since dotenv.config() runs synchronously right after
// this import in server.js.

console.log = (...args) => {
  if (logToFile()) {
    writeToFile(formatLine('INFO ', args));
    if (!isProduction()) originalConsole.log(...args);  // dev: also to stdout
  } else {
    originalConsole.log(...args);
  }
};

console.info = (...args) => {
  if (logToFile()) {
    writeToFile(formatLine('INFO ', args));
    if (!isProduction()) originalConsole.info(...args);
  } else {
    originalConsole.info(...args);
  }
};

console.warn = (...args) => {
  if (logToFile()) {
    writeToFile(formatLine('WARN ', args));
  }
  originalConsole.warn(...args);  // warnings always go to stderr too
};

console.error = (...args) => {
  if (logToFile()) {
    writeToFile(formatLine('ERROR', args));
  }
  originalConsole.error(...args);  // errors always go to stderr too
};

console.debug = (...args) => {
  if (logToFile()) {
    writeToFile(formatLine('DEBUG', args));
    if (!isProduction()) originalConsole.debug(...args);
  } else {
    originalConsole.debug(...args);
  }
};

// ─── Startup banner ───────────────────────────────────────────────────────────
// Deferred to next tick so dotenv.config() has already run when it fires.

process.nextTick(() => {
  if (!logToFile()) return;

  writeToFile(formatLine('INFO ', [
    `Wolffie started | PID=${process.pid} | env=${process.env.NODE_ENV} | retention=${retentionDays()}d | logDir=${LOG_DIR}`
  ]));
  originalConsole.log(`Logging to: ${todayLogPath()}`);

  // First cleanup after dotenv has loaded
  cleanOldLogs();
});

// ─── Recurring cleanup (every 24 hours) ──────────────────────────────────────

setInterval(cleanOldLogs, 24 * 60 * 60 * 1000).unref();

// ─── Exports ──────────────────────────────────────────────────────────────────

/** Original unpatched console — use if you explicitly want stdout only */
export const rawConsole = originalConsole;

/** Path to today's log file */
export const currentLogFile = () => todayLogPath();

/** Manually trigger cleanup (e.g. from an admin API endpoint) */
export const triggerCleanup = cleanOldLogs;