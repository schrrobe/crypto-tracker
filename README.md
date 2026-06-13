# Crypto Tracker

Persönlicher Krypto-Portfolio-Tracker (kein Trading, keine Withdrawals): Bestände aus Exchanges
(read-only API-Keys), Wallets (öffentliche Adressen), CSV-Importen und manueller Eingabe —
aggregiert in EUR/USD über CoinGecko-Preise.

Vollständiger Architektur- und Umsetzungsplan: siehe `docs/PLAN.md` ·
Aktueller Implementierungs-Stand: `docs/IMPLEMENTATION-STATE.md`

## Stack

- **apps/mobile** — Ionic Vue + TypeScript + Pinia + Capacitor (native iOS/Android)
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

## Tests

```bash
pnpm test           # Unit + Integration (Docker-Postgres muss laufen)
pnpm test:e2e       # Playwright-E2E (startet eigene API/App auf :3011/:5174, DB crypto_tracker_e2e)
pnpm typecheck      # tsc + vue-tsc über alle Workspaces
pnpm lint           # ESLint
```

Einzelne Testdatei:

```bash
# API (vitest)
pnpm --filter @crypto-tracker/api exec vitest run src/providers/exchanges/kraken.test.ts

# Mobile (vitest)
pnpm --filter @crypto-tracker/mobile exec vitest run src/services/api.client.test.ts

# E2E (Playwright)
pnpm --filter @crypto-tracker/e2e exec playwright test tests/auth.spec.ts
```

Integrationstests nutzen die DB `crypto_tracker_test` (wird automatisch per `vitest.global-setup.ts`
via `docker exec` angelegt — Postgres-Container `crypto-tracker-postgres` muss laufen).
API-Tests laufen seriell (`fileParallelism: false`), da sie die DB teilen.

## Deployment

### Voraussetzungen

- Node.js ≥ 20, pnpm
- PostgreSQL (Prod: managed DB empfohlen)
- Secrets aus einem Secret Manager (kein `.env`-File auf dem Server)

### Umgebungsvariablen generieren

```bash
openssl rand -base64 32   # JWT_SECRET, JWT_REFRESH_SECRET
openssl rand -hex 32      # ENCRYPTION_KEY (32 Bytes hex)
```

### API deployen

```bash
# Vorlage kopieren und Werte befüllen
cp apps/api/.env.prod.example apps/api/.env.prod

pnpm --filter @crypto-tracker/api build   # transpiliert nach dist/
pnpm db:migrate:prod                      # prisma migrate deploy (non-interactive, safe)
node apps/api/dist/index.js
```

`APP_ENV=prod`: `src/config/env.ts` verweigert den Start mit Default-Secrets oder
`localhost`-CORS-Origins — Fehlkonfiguration fliegt sofort auf.

### Mobile (Web-App) deployen

```bash
pnpm --filter @crypto-tracker/mobile build   # Vite-Build → apps/mobile/dist/
# dist/ als statisches Verzeichnis hinter einem Reverse-Proxy (nginx, Caddy, …) ausliefern
# VITE_API_URL muss auf die prod-API zeigen (Build-Zeit-Variable)
```

### Bekannte Lücken vor prod

- Refresh-Token im Web weiterhin im `localStorage`-Fallback (nativ verschlüsselt im
  Keychain/Keystore) — für Web-Deployment auf `httpOnly`-Cookie umstellen
- Kein CI/CD aufgesetzt (Lint/Tests/E2E)
- Hosting-Entscheidung offen (VPS, Fly.io, GCP, …)

## Native App (Capacitor)

Die App läuft als native iOS/Android-App über Capacitor. Refresh-Token liegt nativ
verschlüsselt (Keychain/Keystore), Datei-Exporte (CSV/PDF) gehen über das System-
Share-Sheet, externe Links über den In-App-Browser.

```bash
# Web-Bundle bauen und in die nativen Projekte synchronisieren
pnpm --filter @crypto-tracker/mobile cap:sync

# Android: Build + Run (Emulator/Gerät) — braucht JDK 17+ und Android SDK
pnpm --filter @crypto-tracker/mobile cap:android

# App-Icons/Splash aus apps/mobile/assets/{icon,splash}.png generieren
pnpm --filter @crypto-tracker/mobile cap:assets
```

**On-Device-Test gegen lokale API:** Das Gerät erreicht `localhost:3010` nicht — in
`apps/mobile/.env` `VITE_API_URL` auf die LAN-IP der Dev-Maschine setzen
(`http://192.168.x.y:3010/api/v1`) und diese Origin in `CORS_ORIGINS` der API ergänzen.
Für Cleartext-HTTP im Dev-Build die Android-Network-Security-Config anpassen
(nicht für prod).

**iOS:** Das Projektgerüst wird auf einem Mac erzeugt (`npx cap add ios`); Build/Test
erfordern macOS + Xcode. Das Android-Gerüst (`apps/mobile/android/`) ist eingecheckt;
der Gradle-Build selbst braucht eine lokale Android-Toolchain (JDK + SDK).
