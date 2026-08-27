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
    // Runs ONCE before the suite: the bootstrapped SuperAdmin has to finish its
    // first login, exactly as an operator does, or every guarded route answers
    // 403 PASSWORD_CHANGE_REQUIRED. See the file for why this is not a
    // workaround — the gate itself is still tested in session.integration.
    globalSetup: ['./tests/helpers/integration-global-setup.ts'],
    globals: true,
    include: ['**/*.integration.spec.ts'],
    // One server, one database: parallel files would race on the single
    // SuperAdmin and on the login throttle's per-subject budget.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
