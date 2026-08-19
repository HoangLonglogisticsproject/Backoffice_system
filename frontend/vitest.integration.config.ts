import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Integration specs, run against a REAL backend and a REAL PostgreSQL.
 *
 * Separate from the unit config on purpose. These need a server on the other
 * end, so they cannot run in CI without one and must never be mixed into the
 * suite that gates a build. `npm test` excludes them; `npm run test:integration`
 * is the deliberate way in.
 *
 * Node environment, not jsdom: this exercises HTTP and cookie mechanics, and a
 * simulated DOM would only add a fetch implementation nobody ships.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['**/*.integration.spec.ts'],
    // One server, one database: parallel files would race on the single
    // SuperAdmin and on the login throttle's per-subject budget.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
