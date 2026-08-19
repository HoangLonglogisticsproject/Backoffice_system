import path from "node:path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
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
  },
})
