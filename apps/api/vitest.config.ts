import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Integrationstests teilen sich eine DB — Dateien seriell ausführen
    fileParallelism: false,
    globalSetup: './vitest.global-setup.ts',
    // env.ts validiert beim Import — Tests brauchen vollständige Konfiguration.
    // FAKE_PRICES/FAKE_PROVIDERS: deterministische Integrationstests ohne externe APIs.
    env: {
      APP_ENV: 'local',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://crypto:crypto@localhost:5434/crypto_tracker_test?schema=public',
      JWT_SECRET: 'vitest-jwt-secret-123',
      JWT_REFRESH_SECRET: 'vitest-refresh-secret-123',
      ENCRYPTION_KEY: '2222222222222222222222222222222222222222222222222222222222222222',
      CORS_ORIGINS: 'http://localhost:5173',
      FAKE_PRICES: 'true',
      FAKE_PROVIDERS: 'true',
    },
  },
})
