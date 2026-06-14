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
| Meilenstein 9 (Capacitor/Native) | 🟦 Android-Gerüst + native Integration fertig; Gradle-Build/iOS extern |
| Tests | 295 grün (API: Unit + Integration), 18 Frontend-Unit, 36 E2E (Playwright) |
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
| — | Wertverlauf-Chart: `GET /portfolio/history` (24h/7d/30d, EUR/USD, CoinGecko market_chart on-demand mit 30-min-Cache, Top-10-Assets), SVG-Chart mit Range-Umschalter und Delta-Prozent | `f48ff7c` |
| — | Steuerreport DE/AT: manuelle Transaktionen (CRUD, auto-verwaltete MANUAL-Quelle, Netto-Bestände), historische EUR-Tagespreise (CoinGecko /history, DB-/Negativ-Cache, Lookup-Cap), reine Tax-Engine (DE: FIFO, Haltefrist, Freigrenze 600/1000 €; AT: Stichtag 1.3.2021, Altvermögen-FIFO + 440 €, Neuvermögen-Durchschnittspreis 27,5 %), `GET /tax/report`, Report-Seite mit Disclaimer/Warnungen/CSV-Export | `3c18d67` |
| — | Steuerreport-Ausbau: `TransferLink` (WITHDRAWAL↔DEPOSIT-Paare, Validierung, Link-UI) + **wallet-bezogenes FIFO** für DE (BMF 10.05.2022, Kostenbasis zieht bei verknüpften Transfers um), TxType `STAKING_REWARD` (DE: §22 Nr. 3, Zufluss-Einkommen + Freigrenze 256 €; AT: §27b Abs. 2, Basis 0), Backfill-Cap 150 mit CoinGecko-Key, PDF-Export (jsPDF, immer Deutsch) | `81fcd64` |
| — | Background-Sync: optionaler Queue-Modus (BullMQ/Redis via `REDIS_URL`, Worker-Prozess, Preis-Refresh-Cron alle 15 min); ohne Redis weiterhin inline. Kleinkram: Quellen-Umbenennen-UI, Solana-Dust-Filter (`includeUnknownTokens`, Default aus), CSV-Presets Kraken/Bitpanda, Transaktionsliste pro CSV-Quelle | `3768a03` |
| — | On-Chain-Staking-Rewards: Wallet-Syncs erzeugen STAKING_REWARD-Transaktionen (idempotent via `Transaction.externalRef`). Solana: `getInflationReward` je Epoche/Stake-Account (inkrementell, Erst-Import 30 Epochen, nativ gestakte SOL im Bestand). Neuer **Ethereum-Wallet-Provider** (eth_getBalance + 10 kuratierte ERC-20 inkl. stETH/wstETH/rETH); Validator-Rewards via beaconcha.in-Withdrawals (braucht `BEACONCHAIN_API_KEY`, Principal-Filter ≥ 8 ETH). Report-Hinweis `WALLET_REWARDS_ONLY` | `7443a98` |
| — | **Multi-Portfolio**: strikt getrennte Steuersubjekte unter einem Account (Portfolio-Modell, jede Quelle gehört zu genau einem; optionale `portfolioId` auf allen Lese-/Anlage-Endpunkten, Default-Fallback; eine MANUAL-Quelle pro Portfolio, Transfer-Links nur innerhalb; CRUD mit Löschregeln). UI: Switcher in allen Tab-Headern, Verwaltung in den Einstellungen. **Markt-Tab**: Top 100/Gewinner/Verlierer über CoinGecko `/coins/markets` (Proxy, 60-s-Cache) | `0aece14` |
| — | **Freemium (Free/Pro)**: `User.plan`, geteilte Entitlements (Free: 2 Portfolios, 5 Quellen, Verlauf 24h/7d/30d; Pro: unbegrenzt + Steuerreport + 1-Jahres-Verlauf + autoSync). Backend-Gating via `requirePro`/Limit-Checks → 402 `PLAN_UPGRADE_REQUIRED`. Frontend: Paywall-Modal (öffnet bei 402 + an Schloss-Icons), Plan-Anzeige/Upgrade/Verwalten in den Einstellungen, Dev-Plan-Schalter (nur local). **Stripe** (Web): Checkout/Portal + signierter Webhook setzt den Plan; inert ohne Keys. **Auto-Sync (Pro):** Worker-Cron (`auto-sync`, `AUTO_SYNC_EVERY_MINUTES`) synct die Quellen aller Pro-Nutzer mit `autoSyncEnabled` automatisch (Toggle in den Einstellungen); braucht Redis+Worker. **Offen:** native IAP (Apple/Google) für die Store-Builds | `HEAD` |
| — | **Meilenstein 9 — Capacitor**: Capacitor 8 integriert (Android-Projektgerüst eingecheckt, iOS folgt auf Mac). Persistenz über Storage-Abstraktion (`storage.ts`): Refresh-Token verschlüsselt im Keychain/Keystore (`@aparajita/capacitor-secure-storage`), übrige Keys in `@capacitor/preferences`; synchroner In-Memory-Cache mit `preloadStorage()` im Bootstrap, damit Web-Verhalten/E2E unberührt bleiben. Native Datei-Exporte (CSV/PDF) über Filesystem + Share-Sheet, externe Links über In-App-Browser, StatusBar/Keyboard/SplashScreen/Android-Back-Button. Platzhalter-Icon in `apps/mobile/assets/`. **Offen extern:** Gradle-APK-Build (JDK/SDK) und iOS-Build (macOS/Xcode) | `HEAD` |
| — | **Passwort-Reset**: `POST /auth/forgot-password` (immer 204, keine User-Enumeration) erzeugt Einmal-Token (gehasht, 30 min TTL), Zustellung per SMTP (nodemailer) oder Konsolen-Fallback ohne SMTP-Config; `POST /auth/reset-password` setzt Passwort, verbraucht Token, beendet alle Sessions. Frontend: „Passwort vergessen?"-Link, Anforderungs- und Reset-Seite (Token aus `?token=`), 6 Sprachen | `HEAD` |
| — | **Provider-Ausbau**: 7 neue Exchanges (Binance inkl. LD-Earn-Normalisierung, OKX, Bybit, KuCoin, Bitstamp, Gate.io, Crypto.com — nur Spot, OKX/KuCoin mit Pflicht-Passphrase) + 10 neue Chains (Polygon/Arbitrum/Base/BSC über generische EVM-Factory mit kuratierten Token-Listen; Litecoin/Dogecoin via Blockchair; Cardano via Koios; XRP via JSON-RPC; Tron via TronGrid inkl. USDT-TRC20; Cosmos via LCD inkl. Staking). Verkabelungs-Smoke-Test über alle Provider, API-Key-Anleitungen je Exchange in 6 Sprachen | `HEAD` |

## Architektur-Eckpunkte

- **Monorepo**: `apps/api` (Express, Prisma, Zod) · `apps/mobile` (Ionic Vue, Pinia, vue-i18n) · `packages/shared` (Zod-Schemas/DTOs/Enums) · `e2e` (Playwright)
- **Zentrale Abstraktion** `PortfolioSource`: jede Verbindung/jeder Import/manuelle Topf ist eine Quelle; Holdings hängen immer an genau einer Quelle (Herkunft bleibt sichtbar)
- **Provider-Interface + Registry**: 6 echte Provider; `FAKE_PROVIDERS`/`FAKE_PRICES` (nur `APP_ENV=local`) liefern deterministische Werte für Tests
- **Sicherheit**: Secrets AES-256-GCM-verschlüsselt, API liefert nur `…1234`-Preview; Ownership überall via `userId` aus dem JWT (404 statt 403, getestet); Rate-Limiting auf `/auth`
- **Beträge**: durchgehend String/`Prisma.Decimal`/BigInt — kein float in der Geld-Pipeline
- **Lokale Ports**: API **3010**, App **5173**, Postgres **5434** (5432/5433 sind auf diesem Host belegt); E2E isoliert auf 3011/5174 mit DB `crypto_tracker_e2e`, Integrationstests auf `crypto_tracker_test`

## Bekannte Einschränkungen / bewusste Entscheidungen

- **CoinGecko-Rate-Limit (ohne API-Key)**: Markt-Tab und Wertverlauf (`/portfolio/history`, 1 `market_chart`-Call je Asset) treffen den Free-Tier-Limit schnell. Der CoinGecko-Client ist gehärtet (`cgFetchJson`: Nicht-JSON/Fehler → sauberer 502 statt 500; Markt + Chart liefern bei Ausfall den letzten Cache-Stand; History überspringt fehlschlagende Assets statt komplett zu scheitern). Echter Fix gegen das Limit: kostenloser `COINGECKO_API_KEY` (in `.env.example` dokumentiert)
- **Live-Happy-Path der Exchanges ungetestet** — alle 11 Exchanges sind per Fixtures + Signatur-Known-Answer-Tests verifiziert; der Erfolgsfall braucht echte read-only Keys. Neue Exchanges decken nur Spot/Hauptkonto ab (kein Earn/Margin/Futures). Chain-Provider: Blockchair (LTC/DOGE) hat ein Tageslimit (~1440 Calls), EVM-/Tron-Token-Listen sind kuratiert (kein Indexer)
- **Transaktions-Importe**: gespeichert + Netto-Bestände (BUY/DEPOSIT − SELL/WITHDRAWAL); Kostenbasis/Gewinne rechnet der Steuerreport (`/tax/report`), laufende PnL-Anzeige im Portfolio fehlt weiterhin
- **Steuerreport**: nur Quellen mit Transaktionshistorie (CSV-Transaktionen + manuelle Transaktionen); Quellen mit reinen Bestands-Snapshots werden als „nicht enthalten" ausgewiesen. DE rechnet wallet-bezogenes FIFO (BMF 10.05.2022): verknüpfte Transfers übertragen die Kostenbasis, unverknüpfte Auszahlungen verlieren sie (Warnung). AT nutzt weiterhin globale Pools (dokumentierte Vereinfachung), verknüpfte Transfers sind dort neutral. Annahmen: Altvermögen zuerst (AT), Netzwerkgebühr-Basis verfällt still; Crypto-zu-Crypto-Swaps und FX-Umrechnung nicht abgebildet. CoinGecko-Backfill historischer Kurse nur ~365 Tage zurück (Free Tier), Cap pro Lauf (40, mit Demo-Key 150) mit Hinweis-Warnung. PDF-Export bewusst immer Deutsch (Empfänger Finanzamt/Steuerberater)
- **Asset-Mapping ist global** (Assets nutzerübergreifend); deshalb nur für unmapped Assets erlaubt
- **Refresh-Token**: nativ verschlüsselt im Keychain/Keystore (erledigt); im Web weiterhin localStorage-Fallback — vor Web-prod-Deployment auf httpOnly-Cookies umstellen
- **Quellen-Umbenennen**: Backend (`PATCH /sources/:id`) existiert, UI fehlt
- **Solana-Spam**: hunderte Müll-Tokens werden sauber als unmapped importiert und sind in der UI eingeklappt; ein echter Dust-/Spam-Filter fehlt
- Server-Fehlertexte sind Deutsch; das Frontend lokalisiert über die stabilen `error.code`s (die wichtigsten Codes in allen 6 Sprachen)
- **Queue-Modus ungetestet in CI**: der BullMQ-Pfad (Worker, Repeatable Job) braucht Redis und ist nur manuell verifiziert; Tests laufen ohne `REDIS_URL` im Inline-Modus. Kraken-CSV-Typ „trade" wird bewusst nicht gemappt (Kauf/Verkauf nur über Vorzeichen erkennbar) und landet als Fehlerzeile
- **Staking-Reward-Import, bewusste Grenzen**: Solana-Erst-Import max. 30 Epochen zurück (RPC-Pruning; ältere Historie via CSV); ETH-Validator-Rewards nur mit beaconcha.in-Key (v1-API verlangt inzwischen einen — Antwortform gegen Live-API noch unverifiziert, Fixtures nach v1-Doku); Exit-Withdrawals ≥ 8 ETH werden als Principal übersprungen (Heuristik); stETH-Rebase-Erträge und MEV/Tips nicht erfasst (Disclaimer). ERC-20 nur kuratierte Liste (kein Indexer)

## Nächste Features (priorisiert)

**1. Meilenstein 9 abschließen — nativer Build/Geräte-Test** *(externe Toolchain)*
Code-seitig fertig (Capacitor, Secure Storage, native Datei/Link/Share, UX). Offen:
Gradle-APK-Build auf einer Maschine mit JDK 17+ und Android-SDK, iOS-Gerüst + Build auf
einem Mac (Xcode), Geräte-Test (Session-Persistenz, Share-Sheet, Safe-Areas), echte
App-Icons statt Platzhalter (`apps/mobile/assets/` + `pnpm --filter … cap:assets`).

**2. Praxistest mit echten Keys** *(kein Code, ~30 min)*
Read-only Keys bei Kraken/Bitvavo anlegen und verbinden — der einzige ungetestete
Happy-Path. Befunde fließen ggf. in Symbol-Normalisierung ein.

**3. Deployment dev/prod**
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
