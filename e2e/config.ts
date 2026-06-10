// Gemeinsame E2E-Konstanten — eigene Ports und eigene Datenbank,
// damit Tests parallel zur lokalen Entwicklung laufen können.

export const API_PORT = 3011
export const APP_PORT = 5174

export const E2E_DATABASE_URL =
  'postgresql://crypto:crypto@localhost:5434/crypto_tracker_e2e?schema=public'

export const API_ENV = {
  APP_ENV: 'local',
  NODE_ENV: 'test',
  PORT: String(API_PORT),
  DATABASE_URL: E2E_DATABASE_URL,
  JWT_SECRET: 'e2e-jwt-secret-not-for-prod',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret-not-for-prod',
  ENCRYPTION_KEY: '1111111111111111111111111111111111111111111111111111111111111111',
  CORS_ORIGINS: `http://localhost:${APP_PORT}`,
  // Deterministische Tests: keine echten CoinGecko-/Provider-Calls
  FAKE_PRICES: 'true',
  FAKE_PROVIDERS: 'true',
}
