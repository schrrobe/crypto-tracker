# Crypto Tracker

Persönlicher Krypto-Portfolio-Tracker (kein Trading, keine Withdrawals): Bestände aus Exchanges
(read-only API-Keys), Wallets (öffentliche Adressen), CSV-Importen und manueller Eingabe —
aggregiert in EUR/USD über CoinGecko-Preise.

Vollständiger Architektur- und Umsetzungsplan: siehe `docs/PLAN.md` ·
Aktueller Implementierungs-Stand: `docs/IMPLEMENTATION-STATE.md`

## Stack

- **apps/mobile** — Ionic Vue + TypeScript + Pinia (Capacitor ab Meilenstein 9)
- **apps/api** — Express + TypeScript + Prisma + Zod
- **packages/shared** — gemeinsame Zod-Schemas, DTO-Typen, Enums
- PostgreSQL lokal über Docker Compose (Host-Port **5434**, da 5432/5433 hier belegt sind)

## Lokales Setup

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/mobile/.env.example apps/mobile/.env

pnpm db:up        # Postgres starten (Docker)
pnpm db:migrate   # Prisma-Migrationen
pnpm db:seed      # Asset-Seed (Top-Coins mit CoinGecko-IDs)

pnpm dev          # API (:3010) + App (:5173) parallel
```

Einzeln: `pnpm dev:api` / `pnpm dev:app` · Prisma Studio: `pnpm db:studio` ·
Adminer (optional): `docker compose --profile tools up -d` → http://localhost:8081

**Background-Sync (optional):** `pnpm queue:up` (Redis auf Host-Port 6381),
`REDIS_URL=redis://localhost:6381` in `apps/api/.env`, zusätzlich
`pnpm --filter @crypto-tracker/api dev:worker` starten. Ohne `REDIS_URL`
läuft der Sync inline (auch in allen Tests).

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
```

## Environments

- **local** — voll lauffähig, Defaults in `.env.example` erlaubt
- **dev / prod** — vorbereitet (`apps/api/.env.dev.example`, `.env.prod.example`), noch nicht
  deployed. `src/config/env.ts` verweigert dort den Start mit Default-Secrets oder
  localhost-CORS-Origins.
