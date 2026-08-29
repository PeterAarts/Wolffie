// server/vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js', 'modules/**/tests/*.test.js'],
    isolate: true,
    testTimeout: 10000,
    // 'default' = console output, custom reporter = persistent log file
    reporters: ['default', './tests/reporters/testResultLogger.js'],
  },
});