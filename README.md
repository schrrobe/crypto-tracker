# Crypto Tracker

Personal crypto portfolio tracker (no trading, no withdrawals): balances from exchanges
(read-only API keys), wallets (public addresses), CSV imports, and manual entry —
aggregated in EUR/USD via CoinGecko prices.

Full architecture and implementation plan: see `docs/PLAN.md` ·
Current implementation status: `docs/IMPLEMENTATION-STATE.md`

## What it does

Aggregate all your crypto holdings in one place — read-only, never trading or moving funds:

- **Sources** — connect exchanges via read-only API keys (Kraken, Bitvavo, Coinbase, Bitpanda,
  Binance, OKX, Bybit, KuCoin, Bitstamp, Gate.io, Crypto.com), wallets via public address
  (Bitcoin, Solana, Ethereum + EVM chains, Litecoin, Dogecoin, Cardano, XRP, Tron, Cosmos),
  CSV imports, or manual entry. Every holding belongs to exactly one source, so provenance
  stays visible.
- **Dashboard** — total value in EUR/USD, allocation donut, value history chart, top positions.
  A privacy toggle masks all amounts so you can show the screen to others.
- **Market** — top 100 coins, gainers, losers (CoinGecko proxy).
- **Multi-portfolio** — strictly separated tax subjects under one account (e.g. yourself + family).
- **Tax reports** — Germany (§23 EStG, FIFO) and Austria (§27b EStG, moving average) from
  transaction history, with CSV/PDF export.
- **Staking** — on-chain staking rewards (Solana, Ethereum validators) imported during sync.
- **i18n** — 6 locales (DE/EN/FR/PL/CS/RU). Native iOS/Android builds via Capacitor.

## Stack

- **apps/mobile** — Ionic Vue + TypeScript + Pinia + Capacitor (native iOS/Android)
- **apps/api** — Express + TypeScript + Prisma + Zod
- **packages/shared** — shared Zod schemas, DTO types, enums
- PostgreSQL locally via Docker Compose (host port **5434**, since 5432/5433 are taken here)

## Project structure

pnpm monorepo with four workspaces:

```
crypto-tracker/
├── apps/
│   ├── api/                 # Express + Prisma + Zod backend (ESM)
│   │   ├── prisma/          # schema + migrations + seed
│   │   └── src/
│   │       ├── modules/     # feature modules: <feature>.routes.ts + <feature>.service.ts
│   │       ├── providers/   # exchange/wallet providers + registry + fakes
│   │       ├── coingecko/   # price/market/chart client (rate-limit hardened)
│   │       ├── config/      # env validation
│   │       └── lib/         # crypto, decimal, jwt, errors, mailer …
│   └── mobile/              # Ionic Vue app (the frontend)
│       ├── android/         # generated Capacitor Android project
│       ├── assets/          # source app icon/splash
│       └── src/
│           ├── views/       # pages (dashboard, holdings, market, sources, tax …)
│           ├── components/   # shared components (charts, switcher, modals)
│           ├── stores/      # Pinia stores per domain
│           ├── services/    # api client, storage, privacy, format, …
│           └── i18n/        # 6 locale files
├── packages/shared/         # Zod schemas, DTOs, enums (consumed by api + mobile)
├── e2e/                     # Playwright end-to-end tests
└── docs/                    # PLAN.md (design), IMPLEMENTATION-STATE.md (status)
```

**Core abstraction — `PortfolioSource`:** every connection, import, or manual bucket is a source;
every holding belongs to exactly one source. Sync, imports, and aggregation all hang off this model.
Money is never a float — amounts flow as string / `Prisma.Decimal` / BigInt end to end.

## Local setup

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/mobile/.env.example apps/mobile/.env

pnpm db:up        # start Postgres (Docker)
pnpm db:migrate   # Prisma migrations
pnpm db:seed      # asset seed (top coins with CoinGecko IDs)

pnpm dev          # API (:3010) + app (:5173) in parallel
```

Individually: `pnpm dev:api` / `pnpm dev:app` · Prisma Studio: `pnpm db:studio` ·
Adminer (optional): `docker compose --profile tools up -d` → http://localhost:8081

**Admin panel:** `pnpm dev:all` also starts the admin app on http://localhost:5175.
Access is gated by the `isAdmin` role — grant it with
`pnpm --filter @crypto-tracker/api admin:grant <email>`.

Local dev admin (seeded manually, **local only**): email `admin@local.dev`
(password is not stored here — ask the maintainer or reset it).

**Background sync (optional):** `pnpm queue:up` (Redis on host port 6381),
set `REDIS_URL=redis://localhost:6381` in `apps/api/.env`, and additionally run
`pnpm --filter @crypto-tracker/api dev:worker`. Without `REDIS_URL` the sync
runs inline (also in all tests).

**CoinGecko API key (recommended):** the Market tab and value history call CoinGecko
per asset and hit the free-tier rate limit quickly without a key. Get a free Demo key at
`https://www.coingecko.com/en/developers/dashboard` and set `COINGECKO_API_KEY=CG-…`
in `apps/api/.env`. Without a key the app degrades gracefully (cached/empty), never 500.

## Tests

```bash
pnpm test           # unit + integration (Docker Postgres must be running)
pnpm test:e2e       # Playwright e2e (boots its own API/app on :3011/:5174, DB crypto_tracker_e2e)
pnpm typecheck      # tsc + vue-tsc across all workspaces
pnpm lint           # ESLint
```

Single test file:

```bash
# API (vitest)
pnpm --filter @crypto-tracker/api exec vitest run src/providers/exchanges/kraken.test.ts

# Mobile (vitest)
pnpm --filter @crypto-tracker/mobile exec vitest run src/services/api.client.test.ts

# E2E (Playwright)
pnpm --filter @crypto-tracker/e2e exec playwright test tests/auth.spec.ts
```

Integration tests use the DB `crypto_tracker_test` (created automatically by
`vitest.global-setup.ts` via `docker exec` — the `crypto-tracker-postgres` container must be
running). API tests run serially (`fileParallelism: false`) because they share that DB.

## Deployment

### Prerequisites

- Node.js ≥ 20, pnpm
- PostgreSQL (prod: managed DB recommended)
- Secrets from a secret manager (no `.env` file on the server)

### Generate environment variables

```bash
openssl rand -base64 32   # JWT_SECRET, JWT_REFRESH_SECRET
openssl rand -hex 32      # ENCRYPTION_KEY (32 bytes hex)
```

### Deploy the API

```bash
# copy the template and fill in values
cp apps/api/.env.prod.example apps/api/.env.prod

pnpm --filter @crypto-tracker/api build   # transpiles to dist/
pnpm db:migrate:prod                      # prisma migrate deploy (non-interactive, safe)
node apps/api/dist/index.js
```

With `APP_ENV=prod`, `src/config/env.ts` refuses to start with default secrets or
`localhost` CORS origins — misconfiguration fails fast.

### Deploy the mobile (web) app

```bash
pnpm --filter @crypto-tracker/mobile build   # Vite build → apps/mobile/dist/
# serve dist/ as a static directory behind a reverse proxy (nginx, Caddy, …)
# VITE_API_URL must point to the prod API (build-time variable)
```

### Known gaps before prod

- Refresh token on web still uses the `localStorage` fallback (encrypted in the
  Keychain/Keystore on native) — switch to an `httpOnly` cookie for web deployment
- No CI/CD set up yet (lint/tests/e2e)
- Hosting decision open (VPS, Fly.io, GCP, …)

## Native app (Capacitor)

The app runs as a native iOS/Android app via Capacitor. The refresh token is stored
encrypted on native (Keychain/Keystore), file exports (CSV/PDF) go through the system
share sheet, and external links open in the in-app browser.

```bash
# build the web bundle and sync it into the native projects
pnpm --filter @crypto-tracker/mobile cap:sync

# Android: build + run (emulator/device) — needs JDK 17+ and Android SDK
pnpm --filter @crypto-tracker/mobile cap:android

# generate app icons/splash from apps/mobile/assets/{icon,splash}.png
pnpm --filter @crypto-tracker/mobile cap:assets
```

**On-device testing against the local API:** the device cannot reach `localhost:3010` —
set `VITE_API_URL` in `apps/mobile/.env` to the dev machine's LAN IP
(`http://192.168.x.y:3010/api/v1`) and add that origin to the API's `CORS_ORIGINS`.
For cleartext HTTP in the dev build, adjust the Android network security config
(not for prod).

**iOS:** the project scaffold is generated on a Mac (`npx cap add ios`); build/test
require macOS + Xcode. The Android scaffold (`apps/mobile/android/`) is checked in;
the Gradle build itself needs a local Android toolchain (JDK + SDK).
