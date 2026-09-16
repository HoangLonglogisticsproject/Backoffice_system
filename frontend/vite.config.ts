import path from "node:path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    // The backend's CORS allowlist names http://localhost:4200 (see
    // backend/.env.example). Vite's default 5173 would be refused by the
    // browser before the request ever reached the API.
    port: 4200,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/helpers/setup.ts'],
    // Integration specs talk to a real backend and are run by their own config.
    exclude: ['**/node_modules/**', '**/*.integration.spec.*'],
    /**
     * ★ THE SUITE RUNS IN UTC, ON EVERY MACHINE.
     *
     * `formatDate` renders an INSTANT (`timestamptz`) in the viewer's own zone,
     * which is correct for production and is deliberately left alone. It does
     * mean the rendered day depends on where the renderer is standing:
     * `2026-08-26T03:00:00Z` is 26/8 in UTC and in UTC+7, and 25/8 anywhere west
     * of UTC. Measured, not assumed — under `America/New_York` the roster date
     * assertions fail on exactly that one-day shift.
     *
     * CI runners are UTC, so this was invisible there and would have failed only
     * on a contributor's machine. Pinning the ZONE rather than rewriting each
     * expected date keeps the assertions readable and fixes every one of them at
     * once, including any added later.
     *
     * ⚠ TEST ENVIRONMENT ONLY. Nothing here reaches the bundle: `test` is not
     * part of the build, and no production code reads `TZ`.
     */
    env: { TZ: 'UTC' },

    /**
     * ★ RAISED FROM THE 5s DEFAULT BECAUSE SOME BEHAVIOUR IS GENUINELY SLOW,
     * NOT BECAUSE ANYTHING HANGS.
     *
     * The location form derives a position from the typed address on a 900 ms
     * debounce, and several specs drive that sequence more than once. Five
     * seconds is enough on an idle machine and not enough when the suite's
     * fifty files are sharing the CPU — which showed up as eighteen failures
     * under load, all of them `Test timed out in 5000ms`, in files that pass
     * one at a time.
     *
     * ⚠ A TIMEOUT IS STILL A REAL FAILURE. This buys headroom for a debounce,
     * not permission for a test to wait on something that never happens; a
     * genuinely stuck test now takes fifteen seconds to say so instead of five.
     */
    testTimeout: 15_000,
  },
})
