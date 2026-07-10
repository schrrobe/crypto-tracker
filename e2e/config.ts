// Shared E2E constants — own ports and own database,
// so tests can run in parallel with local development.

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
  // Deterministic tests: no real CoinGecko/provider calls
  FAKE_PRICES: 'true',
  FAKE_PROVIDERS: 'true',
  // Dummy Stripe config so the paywall renders the Upgrade CTA (billing "enabled").
  // No real checkout is performed in tests — the spec only opens/closes the paywall.
  STRIPE_SECRET_KEY: 'sk_test_e2e_dummy',
  STRIPE_PRICE_ID: 'price_e2e_dummy',
  STRIPE_PRICE_LABEL: '4,99 € / Monat',
}
