import 'dotenv/config'
import { z } from 'zod'

const LOCAL_DEFAULT_SECRETS = [
  'local-jwt-secret-change-me',
  'local-refresh-secret-change-me',
  // ENCRYPTION_KEY-Default aus .env.example
  '0000000000000000000000000000000000000000000000000000000000000000',
]

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['local', 'dev', 'prod']).default('local'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  // AES-256-Schlüssel: 32 Bytes als Hex (64 Zeichen)
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY muss 32 Bytes hex sein (64 Zeichen)'),
  CORS_ORIGINS: z.string().transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  COINGECKO_API_KEY: z.string().optional(),
  // Optional: aktiviert den Queue-Modus für Background-Sync (BullMQ-Worker nötig)
  REDIS_URL: z.string().url().optional(),
  SOLANA_RPC_URL: z.string().url().default('https://api.mainnet-beta.solana.com'),
  ETH_RPC_URL: z.string().url().default('https://ethereum-rpc.publicnode.com'),
  // Für den ETH-Validator-Reward-Import erforderlich (kostenloser Key,
  // beaconcha.in verlangt ihn inzwischen für alle API-Endpunkte)
  BEACONCHAIN_API_KEY: z.string().optional(),
  MEMPOOL_API_URL: z.string().url().default('https://mempool.space/api'),
  // Basis-URL der Web-App für Reset-Links (z.B. https://app.example.com). Local-Default
  // zeigt auf den Vite-Dev-Server; der Reset-Link wird daraus + ?token=… gebaut.
  APP_PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  // SMTP optional: ohne SMTP_HOST landet jede Mail (z.B. Reset-Link) nur im API-Log.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // Stripe (Web-Abo). Alle optional → ohne STRIPE_SECRET_KEY ist Billing inaktiv.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),
  STRIPE_SUCCESS_URL: z.string().url().optional(),
  STRIPE_CANCEL_URL: z.string().url().optional(),
  // Intervall des automatischen Sync (Pro) im Worker; ≥ 60 schont Provider-Limits
  AUTO_SYNC_EVERY_MINUTES: z.coerce.number().int().positive().default(60),
  // Nur für Tests/lokale Entwicklung: deterministische Preise und Provider statt echter APIs
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

// In dev/prod sind die local-Defaults verboten — Start wird verweigert.
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
