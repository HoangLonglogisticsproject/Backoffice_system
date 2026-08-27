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
    setupFiles: ['./src/test/setup.ts'],
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
  },
})
