// server/tests/reporters/testResultLogger.js
//
// Custom Vitest reporter — appends one JSON object per test run to a
// persistent log file. Each entry records the execution timestamp,
// summary counts, duration, and individual test results.
//
// Output: tests/results/test-results.jsonl  (JSON Lines format — one JSON object per line)
//
// Usage in vitest.config.js:
//   reporters: ['default', './tests/reporters/testResultLogger.js']

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR  = path.join(__dirname, '..', 'results');
const RESULTS_FILE = path.join(RESULTS_DIR, 'test-results.jsonl');

export default class TestResultLogger {
  constructor() {
    this._results = [];
    this._startTime = null;
  }

  onInit() {
    this._startTime = new Date();
    // Ensure results directory exists
    if (!fs.existsSync(RESULTS_DIR)) {
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
    }
  }

  onTaskUpdate(packs) {
    // Not used — we collect results in onFinished
  }

  onFinished(files) {
    const endTime = new Date();
    const tests = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const file of (files || [])) {
      this._collectTasks(file.tasks, tests);
    }

    for (const t of tests) {
      if (t.status === 'pass') passed++;
      else if (t.status === 'fail') failed++;
      else skipped++;
    }

    const entry = {
      timestamp:  this._startTime.toISOString(),
      duration:   endTime - this._startTime,
      summary:    { total: tests.length, passed, failed, skipped },
      allPassed:  failed === 0,
      tests:      tests.map(t => ({
        name:     t.name,
        suite:    t.suite,
        status:   t.status,
        duration: t.duration,
        error:    t.error || null,
      })),
    };

    // Append as a single JSON line
    try {
      fs.appendFileSync(RESULTS_FILE, JSON.stringify(entry) + '\n', 'utf8');
    } catch (err) {
      console.error(`TestResultLogger: failed to write results — ${err.message}`);
    }
  }

  /** Recursively collect test results from Vitest's task tree */
  _collectTasks(tasks, results, suiteName = '') {
    for (const task of (tasks || [])) {
      if (task.type === 'suite' || task.type === 'collector') {
        const name = suiteName ? `${suiteName} > ${task.name}` : task.name;
        this._collectTasks(task.tasks, results, name);
      } else {
        results.push({
          name:     task.name,
          suite:    suiteName,
          status:   task.result?.state === 'pass' ? 'pass'
                  : task.result?.state === 'fail' ? 'fail'
                  : 'skip',
          duration: task.result?.duration ?? 0,
          error:    task.result?.errors?.[0]?.message ?? null,
        });
      }
    }
  }
}