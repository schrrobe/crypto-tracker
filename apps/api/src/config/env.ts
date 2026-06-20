import 'dotenv/config'
import { z } from 'zod'

const LOCAL_DEFAULT_SECRETS = [
  'local-jwt-secret-change-me',
  'local-refresh-secret-change-me',
  // ENCRYPTION_KEY default from .env.example
  '0000000000000000000000000000000000000000000000000000000000000000',
]

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['local', 'dev', 'prod']).default('local'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  // AES-256 key: 32 bytes as hex (64 characters)
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY muss 32 Bytes hex sein (64 Zeichen)'),
  CORS_ORIGINS: z.string().transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  COINGECKO_API_KEY: z.string().optional(),
  // Optional: enables queue mode for background sync (BullMQ worker required)
  REDIS_URL: z.string().url().optional(),
  SOLANA_RPC_URL: z.string().url().default('https://api.mainnet-beta.solana.com'),
  ETH_RPC_URL: z.string().url().default('https://ethereum-rpc.publicnode.com'),
  // Required for the ETH validator reward import (free key,
  // beaconcha.in now requires it for all API endpoints)
  BEACONCHAIN_API_KEY: z.string().optional(),
  MEMPOOL_API_URL: z.string().url().default('https://mempool.space/api'),
  // Base URL of the web app for reset links (e.g. https://app.example.com). The local default
  // points at the Vite dev server; the reset link is built from it + ?token=…
  APP_PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  // SMTP optional: without SMTP_HOST every mail (e.g. reset link) only lands in the API log.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // Stripe (web subscription). All optional → without STRIPE_SECRET_KEY billing is inactive.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),
  STRIPE_SUCCESS_URL: z.string().url().optional(),
  STRIPE_CANCEL_URL: z.string().url().optional(),
  // Interval of the automatic sync (Pro) in the worker; ≥ 60 spares provider limits
  AUTO_SYNC_EVERY_MINUTES: z.coerce.number().int().positive().default(60),
  // Force-update gate: minimum native client version per platform (e.g. "1.0.0").
  // Unset → gate inactive. Older clients are blocked with a link to the store URL.
  MIN_CLIENT_VERSION_ANDROID: z.string().optional(),
  MIN_CLIENT_VERSION_IOS: z.string().optional(),
  APP_STORE_URL_IOS: z.string().url().optional(),
  APP_STORE_URL_ANDROID: z.string().url().optional(),
  // Only for tests/local development: deterministic prices and providers instead of real APIs
  FAKE_PRICES: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  FAKE_PROVIDERS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Ungültige Environment-Konfiguration:')
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const env = parsed.data

// In dev/prod the local defaults are forbidden — startup is refused.
if (env.APP_ENV !== 'local') {
  const usedDefaults = [env.JWT_SECRET, env.JWT_REFRESH_SECRET, env.ENCRYPTION_KEY].filter((s) =>
    LOCAL_DEFAULT_SECRETS.includes(s),
  )
  if (usedDefaults.length > 0) {
    console.error(`APP_ENV=${env.APP_ENV}: Default-Secrets aus .env.example sind hier nicht erlaubt.`)
    process.exit(1)
  }
  if (env.CORS_ORIGINS.some((o) => o.includes('localhost'))) {
    console.error(`APP_ENV=${env.APP_ENV}: localhost-Origins sind in CORS_ORIGINS nicht erlaubt.`)
    process.exit(1)
  }
  if (env.FAKE_PRICES || env.FAKE_PROVIDERS) {
    console.error(`APP_ENV=${env.APP_ENV}: FAKE_PRICES/FAKE_PROVIDERS sind nur in local erlaubt.`)
    process.exit(1)
  }
}
