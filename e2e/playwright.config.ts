import { defineConfig, devices } from '@playwright/test'
import { API_ENV, API_PORT, APP_PORT } from './config'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  // Gemeinsame DB pro Lauf — Tests nutzen eigene User, aber seriell bleibt es deterministisch
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @crypto-tracker/api exec tsx src/server.ts',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      env: API_ENV,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm --filter @crypto-tracker/mobile exec vite --port ${APP_PORT} --strictPort`,
      url: `http://localhost:${APP_PORT}`,
      env: { VITE_API_URL: `http://localhost:${API_PORT}/api/v1` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
