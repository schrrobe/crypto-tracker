# Implementierungs-Stand

> Stand: 11.06.2026 · Commit `siehe git log` · Plan: [PLAN.md](./PLAN.md)

Krypto-Portfolio-Tracker (kein Trading, keine Withdrawals): Bestände aus Exchanges
(read-only API-Keys), Wallets (öffentliche Adressen), CSV-Importen und manueller Eingabe,
bewertet in EUR/USD über CoinGecko.

## Status auf einen Blick

| Bereich | Status |
|---|---|
| V1 „Muss" (Meilensteine 0–7) | ✅ komplett |
| V1 „Sollte" (Meilenstein 8) | ✅ komplett |
| Meilenstein 9 (Capacitor/Native) | ⬜ offen |
| Tests | 120 grün: 58 Unit + 24 Integration (API), 11 Unit (Frontend), 27 E2E (Playwright) |
| Deployment | nur local lauffähig; dev/prod per Env-Konzept vorbereitet, nicht deployed |

## Umgesetzte Meilensteine

| # | Inhalt | Commit |
|---|---|---|
| 0 | Monorepo (pnpm Workspaces), Express+Prisma-API, Ionic-Vue-App, Docker-Postgres, Env-Konzept local/dev/prod | `64571dc` |
| 1 | Auth: argon2, JWT (15 min) + rotierende Refresh-Tokens (nur Hash in DB), Router-Guard, 401→Refresh→Retry im api.client | `2b52ff6` |
| 2 | Manuelle Bestände, CoinGecko-Preise (EUR/USD, 60s-Cache, append-only Historie), Portfolio-Summary, Dashboard | `d713a9d` |
| 3 | Sync-Gerüst: AES-256-GCM-Key-Verschlüsselung, Provider-Registry, SyncService (queue-ready, ohne Express-Abhängigkeit), SyncRun-Log | `0ac397a` |
| 4 | Echte Wallet-Provider: Bitcoin (mempool.space), Solana (JSON-RPC, SPL via Mint-Mapping) — live verifiziert | `663e6dc` |
| 5 | Kraken (HMAC-SHA512, Known-Answer-Test) + Bitvavo (HMAC-SHA256), Symbol-Normalisierung (XXBT→BTC, ETH2.S→ETH) | `3d40ee1` |
| 6 | Generischer CSV-Import: Upload → Spalten-Mapping (Heuristik de/en) → Fehlerzeilen mit Zeilennummer, Import-Historie | `b477d69` |
| — | Mehrsprachigkeit: DE/EN/FR/PL/CS/RU (vue-i18n, typgeprüfte Locale-Dateien, lokalisierte Formate) | `f243737` |
| 7 | Polish: Onboarding-Einstiege, lokalisierte API-Fehler-Codes, Basiswährung EUR/USD, Loading-/Error-States, Spam-Token-Collapse | `acb2142` |
| 8 | Coinbase (CDP-Keys, ES256-JWT) + Bitpanda (nur API-Key), CSV-Transaktions-Import mit Netto-Beständen, Allocation-Donut, manuelles CoinGecko-Mapping | `002e6ae` |
| — | Testlücken: Tenant-Isolation (Supertest), Sync-/Import-Integrationstests, Frontend-Unit-Tests (api.client) | `f47cf75` |
| — | Wertverlauf-Chart: `GET /portfolio/history` (24h/7d/30d, EUR/USD, CoinGecko market_chart on-demand mit 30-min-Cache, Top-10-Assets), SVG-Chart mit Range-Umschalter und Delta-Prozent | `HEAD` |

## Architektur-Eckpunkte

- **Monorepo**: `apps/api` (Express, Prisma, Zod) · `apps/mobile` (Ionic Vue, Pinia, vue-i18n) · `packages/shared` (Zod-Schemas/DTOs/Enums) · `e2e` (Playwright)
- **Zentrale Abstraktion** `PortfolioSource`: jede Verbindung/jeder Import/manuelle Topf ist eine Quelle; Holdings hängen immer an genau einer Quelle (Herkunft bleibt sichtbar)
- **Provider-Interface + Registry**: 6 echte Provider; `FAKE_PROVIDERS`/`FAKE_PRICES` (nur `APP_ENV=local`) liefern deterministische Werte für Tests
- **Sicherheit**: Secrets AES-256-GCM-verschlüsselt, API liefert nur `…1234`-Preview; Ownership überall via `userId` aus dem JWT (404 statt 403, getestet); Rate-Limiting auf `/auth`
- **Beträge**: durchgehend String/`Prisma.Decimal`/BigInt — kein float in der Geld-Pipeline
- **Lokale Ports**: API **3010**, App **5173**, Postgres **5434** (5432/5433 sind auf diesem Host belegt); E2E isoliert auf 3011/5174 mit DB `crypto_tracker_e2e`, Integrationstests auf `crypto_tracker_test`

## Bekannte Einschränkungen / bewusste Entscheidungen

- **Live-Happy-Path der Exchanges ungetestet** — Kraken/Bitvavo/Coinbase/Bitpanda sind per Fixtures + Live-Fehlerpfad verifiziert; der Erfolgsfall braucht echte read-only Keys
- **Transaktions-Importe**: gespeichert + Netto-Bestände (BUY/DEPOSIT − SELL/WITHDRAWAL); keine PnL-/Kostenbasis-Berechnung; keine Transaktions-Liste in der UI
- **Asset-Mapping ist global** (Assets nutzerübergreifend); deshalb nur für unmapped Assets erlaubt
- **Refresh-Token im localStorage (Web)** — für local ok; vor prod-Deployment auf httpOnly-Cookies (Web) bzw. Capacitor Secure Storage (nativ) umstellen
- **Quellen-Umbenennen**: Backend (`PATCH /sources/:id`) existiert, UI fehlt
- **Solana-Spam**: hunderte Müll-Tokens werden sauber als unmapped importiert und sind in der UI eingeklappt; ein echter Dust-/Spam-Filter fehlt
- Server-Fehlertexte sind Deutsch; das Frontend lokalisiert über die stabilen `error.code`s (die wichtigsten Codes in allen 6 Sprachen)

## Nächste Features (priorisiert)

**1. Meilenstein 9 — Native Apps (letzter Plan-Meilenstein)**
Capacitor-Konfiguration, iOS-/Android-Builds, Token-Speicherung via Secure Storage statt
localStorage, Safe-Areas/Statusbar, Geräte-Test. Voraussetzung für den eigentlichen
Produktanspruch „native App".

**2. Praxistest mit echten Keys** *(kein Code, ~30 min)*
Read-only Keys bei Kraken/Bitvavo anlegen und verbinden — der einzige ungetestete
Happy-Path. Befunde fließen ggf. in Symbol-Normalisierung ein.

**3. Background-Sync** *(Plan „Später", architektonisch vorbereitet)*
BullMQ/Redis-Worker ruft `SyncService.syncSource()` unverändert auf; Endpoint enqueued
nur noch, Frontend pollt den Run-Status (UI dafür existiert). Dazu Cron für
Preis-Refresh (`price.service.refreshPrices()` ist cron-ready).

**4. Kleinere sinnvolle Lücken**
Quellen-Umbenennen-UI, Transaktions-Liste pro CSV-Quelle, Dust-Filter für Solana,
provider-spezifische CSV-Formate (Kraken-/Bitpanda-Export ohne manuelles Mapping).

**5. Deployment dev/prod**
Env-Konzept und `migrate deploy` sind vorbereitet; es fehlen Hosting-Entscheidung,
Secret Manager, CI (Lint/Tests/E2E) und die Cookie-Umstellung aus den Einschränkungen.

**Bewusst nicht geplant** (laut Plan): Trading, Withdrawals, Key-Custody, Steuer-Reports.

## Entwickler-Kurzreferenz

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed   # einmalig
pnpm dev                                        # API :3010 + App :5173
pnpm test                                       # Unit + Integration (braucht Docker-Postgres)
pnpm test:e2e                                   # Playwright (eigene Ports/DB)
pnpm typecheck && pnpm lint
```
