# Krypto-Portfolio-Tracker — Technischer Projektplan

## Kontext

Neues Greenfield-Projekt (Vorschlag: `/home/robert/www/crypto-tracker`). Eine Portfolio-Tracking-App (kein Trading, keine Withdrawals), mit der Nutzer Krypto-Bestände aus Exchanges (read-only API-Keys), Wallets (öffentliche Adressen), CSV-Importen und manueller Eingabe zusammenführen. Mobile-first mit Ionic Vue + Capacitor, Backend mit Express + Prisma + PostgreSQL. V1 läuft vollständig lokal; dev/prod sind vorbereitet, aber nicht deployed.

---

## 1. Kurzbeschreibung der App

Ein persönlicher Krypto-Portfolio-Tracker: Nutzer registrieren sich per E-Mail/Passwort, verbinden Quellen (Exchange, Wallet, CSV, manuell), klicken „Synchronisieren", und sehen ihren Gesamtbestand in EUR und USD — aggregiert über alle Quellen, mit Sync-Status und Fehleranzeige. Alle Daten liegen normalisiert in der eigenen PostgreSQL-Datenbank; das Frontend spricht ausschließlich mit der eigenen REST-API.

## 2. Produktumfang

**In Scope:** Auth, Quellen-Verwaltung, manueller Sync, Bestands-Aggregation, CSV-Import mit Spalten-Mapping, CoinGecko-Preise (EUR/USD), Sync-Historie, Dark/Light Mode, native iOS/Android + Web.

**Out of Scope (bewusst nicht Teil der App):** Trading, Withdrawals, Custody/Private Keys, Steuer-Reports, Schreibzugriff auf Exchanges, Social Features, Echtzeit-Kurse/Websockets.

## 3. MVP-Abgrenzung

| Kategorie | Inhalt |
|---|---|
| **Muss in V1** | Auth (Register/Login/JWT), manuelle Bestände, Dashboard mit Gesamtwert EUR/USD, CoinGecko-Preise, Dark/Light Mode, generischer CSV-Import (Bestände) mit Mapping + Fehlerzeilen, Quellen-CRUD, manueller Sync mit SyncRun-Log, **2 Exchanges (Kraken, Bitvavo)**, Bitcoin- + Solana-Wallets (Adresse), verschlüsselte Key-Speicherung |
| **Sollte in V1** | Coinbase + Bitpanda, CSV-Transaktions-Import (gespeichert, ohne PnL-Berechnung), Import-Historie mit Detail, Allocation-Chart (Donut), Asset-Suche mit CoinGecko-Mapping-Override |
| **Später** | Background-Sync (BullMQ/Cron), Preis-Historie + Charts, xpub-Support für Bitcoin, provider-spezifische CSV-Formate, PnL/Kostenbasis, 2FA, Push-Notifications, Refresh-Token-Rotation mit Device-Verwaltung |
| **Bewusst nie** | Trading, Withdrawals, Key-Custody, Schreib-Scopes |

## 4. Systemarchitektur

```
┌─────────────────────────────┐
│  Ionic Vue App (Capacitor)  │  iOS / Android / Web
│  Pinia · Vue Router · TS    │
└──────────────┬──────────────┘
               │ REST (JSON, Bearer JWT)
┌──────────────▼──────────────┐
│   Express API (TypeScript)  │
│  Routes → Services → Prisma │
│  ┌────────────────────────┐ │
│  │ Provider-Registry      │ │──► Kraken / Bitvavo / Coinbase / Bitpanda APIs
│  │ (Exchange + Wallet)    │ │──► mempool.space (BTC) / Solana RPC
│  └────────────────────────┘ │
│  CoinGecko-Client (Preise)  │──► CoinGecko API
└──────────────┬──────────────┘
               │ Prisma
┌──────────────▼──────────────┐
│   PostgreSQL (Docker local) │
└─────────────────────────────┘
```

Prinzipien:
- Frontend liest **nur** aus der eigenen API — nie direkt von Providern oder CoinGecko.
- Sync läuft in V1 synchron im Request (dauert Sekunden), aber die Sync-Logik liegt in einem `SyncService`, der später unverändert aus einem Queue-Worker (BullMQ) aufrufbar ist.
- Provider sind hinter einem Interface gekapselt; neue Provider = neue Datei + Registry-Eintrag.

## 5. Monorepo-Struktur (pnpm Workspaces)

```
crypto-tracker/
├── apps/
│   ├── api/                  # Express-Backend
│   └── mobile/               # Ionic Vue + Capacitor (auch Web-Build)
├── packages/
│   └── shared/               # Zod-Schemas, DTO-Typen, Enums (von beiden Apps genutzt)
├── docker-compose.yml        # PostgreSQL (+ optional Adminer)
├── pnpm-workspace.yaml
├── package.json              # Root-Scripts (dev, db:*, lint, test)
├── .env.example
└── README.md
```

`packages/shared` enthält: API-Request/Response-Zod-Schemas (Single Source of Truth für Validierung + Frontend-Typen via `z.infer`), Enums (`ProviderId`, `SourceType`, `SyncStatus`), keine Runtime-Abhängigkeiten außer Zod. Kein Turborepo in V1 — Root-Scripts mit `pnpm --filter` reichen.

## 6. Frontend-Plan (apps/mobile)

```
apps/mobile/src/
├── main.ts / App.vue
├── router/index.ts            # Auth-Guard (redirect zu /login)
├── stores/                    # Pinia
│   ├── auth.store.ts          # user, tokens, login/logout/refresh
│   ├── portfolio.store.ts     # summary, holdings (gruppiert nach Asset/Quelle)
│   ├── sources.store.ts       # Quellen + Sync-Status
│   └── imports.store.ts       # CSV-Import-Wizard-State + Historie
├── services/
│   ├── api.client.ts          # fetch-Wrapper: Base-URL, Bearer-Token, 401→Refresh→Retry
│   └── *.service.ts           # auth, portfolio, sources, imports (dünn, typisiert via shared)
├── views/
│   ├── auth/LoginPage.vue · RegisterPage.vue
│   ├── DashboardPage.vue      # Tab 1: Gesamtwert, Tageskontext, Top-Assets, Sync-Button
│   ├── HoldingsPage.vue       # Tab 2: alle Bestände, Gruppierung Asset/Quelle umschaltbar
│   ├── sources/
│   │   ├── SourcesPage.vue    # Tab 3: Quellen-Liste mit Status-Badges
│   │   ├── SourceDetailPage.vue   # Bestände der Quelle, Sync-Historie, Löschen
│   │   ├── AddSourceModal.vue     # Typ wählen → Provider → Formular (Key/Adresse/manuell)
│   │   └── csv/CsvImportWizard.vue # Upload → Mapping → Vorschau → Ergebnis (4 Schritte)
│   └── SettingsPage.vue       # Tab 4: Theme, Basiswährung, Logout
├── components/
│   ├── TotalValueCard.vue · AssetListItem.vue · SourceCard.vue
│   ├── SyncStatusBadge.vue    # ok / läuft / Fehler + letzter Sync-Zeitpunkt
│   ├── CsvMappingTable.vue    # Spalten-Dropdowns + 5-Zeilen-Vorschau
│   ├── EmptyState.vue · ErrorBanner.vue · ThemeToggle.vue
│   └── charts/AllocationDonut.vue   # (Sollte)
└── theme/variables.css        # Ionic CSS-Variablen für Dark/Light
```

- **Tabs:** Dashboard · Bestände · Quellen · Einstellungen (`IonTabs`).
- **Dark/Light:** Ionic-Palette via CSS-Klassen (`.ion-palette-dark`), Default = `prefers-color-scheme`, manueller Override in Settings, persistiert via Capacitor Preferences. Fintech-Look: dunkles Navy/Schwarz, eine Akzentfarbe, Grün/Rot nur für Wertänderungen, Zahlen mit `tabular-nums`.
- **Token-Speicherung:** Access-Token nur im Speicher (Pinia), Refresh-Token in Capacitor Preferences (nativ) / localStorage (Web in V1 — Hinweis unter Risiken). Keine Cookies (vereinfacht Capacitor/CORS).
- **Geldbeträge:** als String vom Backend, Anzeige via `Intl.NumberFormat` — nie `parseFloat` für Rechnungen im Frontend.

## 7. Backend-Plan (apps/api)

```
apps/api/src/
├── server.ts / app.ts         # Bootstrap; helmet, cors, json, Routen, Error-Handler
├── config/env.ts              # Zod-validierte Env — Crash beim Start, wenn ungültig
├── middleware/
│   ├── auth.middleware.ts     # JWT prüfen → req.userId
│   ├── validate.middleware.ts # Zod-Schema gegen body/query/params
│   └── error.middleware.ts    # AppError → HTTP, Rest → 500 + Log
├── lib/
│   ├── prisma.ts              # Singleton-Client
│   ├── crypto.ts              # AES-256-GCM encrypt/decrypt (Secrets)
│   ├── jwt.ts                 # sign/verify Access + Refresh
│   └── errors.ts              # AppError(code, status, message, details?)
├── modules/                   # je Modul: *.routes.ts → *.service.ts (Routen dünn, Logik im Service)
│   ├── auth/ · portfolio/ · holdings/ · sources/ · sync/ · imports/ · assets/ · prices/
├── providers/
│   ├── provider.types.ts      # Interfaces (siehe §9)
│   ├── provider.registry.ts   # ProviderId → Implementierung
│   ├── exchanges/kraken.ts · bitvavo.ts · coinbase.ts · bitpanda.ts
│   └── wallets/bitcoin.ts · solana.ts
├── csv/
│   ├── csv.parser.ts          # Parsen + Header-Erkennung (papaparse)
│   ├── csv.mapper.ts          # Mapping anwenden, Zeilen-Zod-Validierung, Fehlerzeilen sammeln
│   └── formats/generic.ts     # V1: generisch; später: kraken.ts etc. (gleiches Interface)
└── coingecko/
    ├── coingecko.client.ts    # /simple/price (gebatcht), /search; Rate-Limit-Schonung
    └── price.service.ts       # Preise upserten, 60s-In-Memory-Cache
```

Konventionen: Services werfen typisierte `AppError`s, Routen fangen nichts selbst; alle DB-Queries enthalten `userId` aus dem Token (nie aus dem Body); Beträge durchgehend `Prisma.Decimal`, im JSON als String serialisiert.

## 8. Datenbank- und Prisma-Modell

```prisma
enum SourceType    { EXCHANGE  WALLET  CSV_IMPORT  MANUAL }
enum ProviderId    { COINBASE  KRAKEN  BITVAVO  BITPANDA  BITCOIN  SOLANA  GENERIC_CSV  MANUAL }
enum SyncStatus    { RUNNING  SUCCESS  ERROR }
enum ImportStatus  { PENDING_MAPPING  COMPLETED  FAILED }
enum ImportKind    { BALANCES  TRANSACTIONS }
enum TxType        { BUY  SELL  DEPOSIT  WITHDRAWAL  TRANSFER  OTHER }

model User {
  id            String   @id @default(uuid())
  email         String   @unique
  passwordHash  String
  baseCurrency  String   @default("EUR")   // Anzeige-Präferenz
  createdAt     DateTime @default(now())
  sources       PortfolioSource[]
  refreshTokens RefreshToken[]
}

model RefreshToken {
  id         String   @id @default(uuid())
  userId     String
  tokenHash  String   @unique              // nur Hash speichern
  expiresAt  DateTime
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// Eine "Quelle" ist die zentrale Abstraktion: jede Verbindung, jeder Import,
// jeder manuelle Topf ist eine PortfolioSource. Holdings hängen immer an einer Quelle.
model PortfolioSource {
  id          String      @id @default(uuid())
  userId      String
  type        SourceType
  provider    ProviderId
  label       String                       // Nutzer-Name, z.B. "Kraken Hauptaccount"
  lastSyncAt  DateTime?
  createdAt   DateTime    @default(now())
  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  credential  ExchangeCredential?
  wallet      WalletAddress?
  holdings    Holding[]
  syncRuns    SyncRun[]
  imports     CsvImport[]
  transactions Transaction[]
  @@index([userId])
}

model ExchangeCredential {                  // nur bei type=EXCHANGE
  id                  String @id @default(uuid())
  sourceId            String @unique
  encryptedApiKey     String                // AES-256-GCM: iv:tag:ciphertext (base64)
  encryptedApiSecret  String
  encryptedPassphrase String?               // Coinbase
  keyPreview          String                // letzte 4 Zeichen, für UI
  source PortfolioSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)
}

model WalletAddress {                       // nur bei type=WALLET
  id       String @id @default(uuid())
  sourceId String @unique
  chain    String                           // "bitcoin" | "solana"
  address  String
  source PortfolioSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)
}

model Asset {
  id          String  @id @default(uuid())
  symbol      String                        // "BTC" — NICHT unique (Symbol-Kollisionen!)
  name        String
  coingeckoId String? @unique               // null = unmapped → kein Preis, UI-Hinweis
  iconUrl     String?
  holdings    Holding[]
  prices      AssetPrice[]
  @@index([symbol])
}

model Holding {                             // aktueller Bestand je Quelle+Asset
  id        String   @id @default(uuid())
  sourceId  String
  assetId   String
  quantity  Decimal  @db.Decimal(38, 18)
  updatedAt DateTime @updatedAt
  source PortfolioSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  asset  Asset           @relation(fields: [assetId], references: [id])
  @@unique([sourceId, assetId])
}

model Transaction {                         // aus CSV-Transaktions-Importen (V1: nur Anzeige)
  id           String   @id @default(uuid())
  sourceId     String
  importId     String?                      // Nachvollziehbarkeit: woher kam die Zeile
  assetId      String
  type         TxType
  quantity     Decimal  @db.Decimal(38, 18)
  pricePerUnit Decimal? @db.Decimal(38, 18)
  feeAmount    Decimal? @db.Decimal(38, 18)
  currency     String?                      // Währung von price/fee
  timestamp    DateTime
  source PortfolioSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  @@index([sourceId, timestamp])
}

model CsvImport {
  id            String       @id @default(uuid())
  sourceId      String
  filename      String
  kind          ImportKind
  status        ImportStatus @default(PENDING_MAPPING)
  columnMapping Json?                       // { quantity: "Amount", symbol: "Coin", ... }
  rawPreview    Json                        // Header + erste Zeilen für Mapping-UI
  totalRows     Int          @default(0)
  importedRows  Int          @default(0)
  errorRows     Json?                       // [{ line, raw, error }]
  createdAt     DateTime     @default(now())
  source PortfolioSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)
}

model SyncRun {
  id           String     @id @default(uuid())
  sourceId     String
  status       SyncStatus
  startedAt    DateTime   @default(now())
  finishedAt   DateTime?
  errorCode    String?                      // z.B. "INVALID_API_KEY", "RATE_LIMITED"
  errorMessage String?
  source PortfolioSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  @@index([sourceId, startedAt])
}

model AssetPrice {                          // jüngste Zeile = aktueller Preis; Historie gratis vorbereitet
  id        String   @id @default(uuid())
  assetId   String
  priceEur  Decimal  @db.Decimal(24, 8)
  priceUsd  Decimal  @db.Decimal(24, 8)
  fetchedAt DateTime @default(now())
  asset Asset @relation(fields: [assetId], references: [id], onDelete: Cascade)
  @@index([assetId, fetchedAt])
}
```

Damit ist die geforderte Trennung strukturell erzwungen: Exchange-Connections, Wallet-Connections, CSV-Importe und manuelle Bestände sind alle eigene `PortfolioSource`-Zeilen unterschiedlichen Typs — Aggregation ist trivial (`Holding` join `PortfolioSource where userId`), Herkunft bleibt immer sichtbar.

## 9. Provider-Architektur

```ts
// providers/provider.types.ts
export interface RawBalance {
  symbol: string            // Provider-Symbol, z.B. "XXBT" bei Kraken
  amount: string            // als String — nie float
  meta?: Record<string, unknown>   // z.B. Solana-Mint-Adresse für exaktes Mapping
}

export interface ExchangeProvider {
  readonly id: ProviderId
  validateCredentials(c: ExchangeCreds): Promise<void>   // beim Anlegen der Quelle
  fetchBalances(c: ExchangeCreds): Promise<RawBalance[]>
}

export interface WalletProvider {
  readonly id: ProviderId
  validateAddress(address: string): boolean              // synchron, Format-Check
  fetchBalances(address: string): Promise<RawBalance[]>
}
```

- **Registry** (`provider.registry.ts`): `Map<ProviderId, ExchangeProvider | WalletProvider>` — der SyncService kennt keine konkreten Provider.
- **Symbol-Normalisierung** je Provider (Kraken `XXBT`→`BTC`, `ZEUR` ignorieren bzw. als Fiat kennzeichnen) in der Provider-Datei selbst — `RawBalance.symbol` ist bereits normalisiert.
- **Asset-Resolution** (assets-Modul): Symbol → `Asset` via Lookup-Tabelle; unbekannte Symbole erzeugen ein Asset mit `coingeckoId = null` (UI: „kein Preis, Mapping prüfen"), plus manueller Override über CoinGecko-Suche. Solana-SPL-Tokens werden über die Mint-Adresse gemappt (CoinGecko unterstützt Contract-Lookup), nicht über das Symbol.
- **Konkrete APIs:**
  - *Kraken:* REST `/0/private/Balance`, HMAC-SHA512 — einfach, zuerst.
  - *Bitvavo:* REST `/v2/balance`, HMAC-SHA256 — einfach.
  - *Coinbase:* Advanced Trade API (CDP-Keys, JWT-Signatur) — etwas mehr Aufwand, danach.
  - *Bitpanda:* `/v1/asset-wallets`, API-Key-Header — zuletzt (API ist eingeschränkt).
  - *Bitcoin:* mempool.space API `GET /api/address/:addr` (funded − spent). V1: einzelne Adressen; xpub später.
  - *Solana:* öffentlicher RPC — `getBalance` (SOL) + `getTokenAccountsByOwner` (SPL). Konfigurierbarer RPC-Endpoint via Env.

## 10. CSV-Import-Architektur

Vierstufiger Ablauf, vollständig nachvollziehbar:

1. **Upload** — `POST /imports` (multipart, Limit 5 MB; Felder: `kind`, optional `sourceId`). Backend parst mit papaparse, erkennt Header, speichert `CsvImport(PENDING_MAPPING)` mit `rawPreview` (Header + erste 10 Zeilen) **und legt die Roh-Zeilen temporär ab** (Json-Spalte am Import). Response: Import-ID, erkannte Spalten, Vorschau, Mapping-Vorschlag (Heuristik: Spaltenname enthält „amount"/„menge" → quantity usw.).
2. **Mapping bestätigen** — Frontend zeigt `CsvMappingTable` (Zielfeld → Spalten-Dropdown). Pflichtfelder Bestände: `symbol`, `quantity`; Transaktionen: zusätzlich `type`, `timestamp`; optional `price`, `fee`, `currency`. `POST /imports/:id/mapping` mit dem bestätigten Mapping.
3. **Ausführung** — Backend wendet Mapping an, validiert jede Zeile mit Zod (Zahlformat inkl. Komma-Dezimaltrenner, Datumsformate, bekanntes Symbol). Gültige Zeilen → in einer DB-Transaktion: neue `PortfolioSource(type=CSV_IMPORT)` (oder gewählte bestehende), Holdings ersetzt bzw. Transactions eingefügt. Fehlerzeilen → `errorRows` mit Zeilennummer, Rohinhalt, Fehlergrund. Ein Import schlägt nie komplett wegen einzelner Zeilen fehl.
4. **Ergebnis + Historie** — Response/`GET /imports/:id`: importiert/fehlerhaft/gesamt + Fehlerliste. `GET /imports` = Historie. Import löschen entfernt die zugehörige Quelle samt Holdings (Cascade).

Erweiterbarkeit: `formats/generic.ts` implementiert ein `CsvFormat`-Interface (`detect(headers)`, `defaultMapping`); provider-spezifische Formate (Kraken-Export etc.) kommen später als weitere Dateien dazu, Schritt 2 wird dann ggf. übersprungen.

## 11. Preis- und CoinGecko-Architektur

- **Client:** `GET /api/v3/simple/price?ids=...&vs_currencies=eur,usd`, IDs gebatcht (bis ~250 pro Call). Optionaler Demo-API-Key via `COINGECKO_API_KEY` (kostenlos, hebt Rate-Limit von ~5 auf 30 req/min).
- **Wann:** beim Sync (nur Assets des Users) und via `POST /prices/refresh`. In-Memory-Cache 60 s verhindert Hammering bei mehreren Syncs. Kein Cron in V1 — `price.service.refreshPrices(assetIds)` ist aber cron-ready.
- **Mapping:** kuratierte Seed-Liste (Top ~100 Symbole → CoinGecko-ID) per `prisma db seed`; Rest über `GET /assets/search` (proxied CoinGecko `/search`) + manuelle Zuordnung in der UI.
- **Historie:** `AssetPrice` ist append-only — aktuellster Datensatz = aktueller Preis, alte Zeilen = kostenlose Historie für spätere Charts. Backend liefert berechnete EUR/USD-Werte mit (`quantity × price`), Frontend rechnet nicht selbst.
- **Fehlerfall CoinGecko down:** Sync der Bestände gelingt trotzdem; Preise bleiben auf letztem Stand, UI zeigt „Preise von <Zeitpunkt>".

## 12. Auth- und Security-Konzept

**Auth-Ablauf:**
1. `POST /auth/register` — E-Mail + Passwort (Zod: min. 10 Zeichen), Hash mit **argon2id**.
2. `POST /auth/login` — bei Erfolg: Access-Token (JWT, 15 min, `sub=userId`) + Refresh-Token (opak, 30 Tage, **nur Hash in DB**).
3. `POST /auth/refresh` — Refresh-Token tauschen (alte Zeile löschen = einfache Rotation), neues Paar zurück.
4. `POST /auth/logout` — Refresh-Token-Zeile löschen. `GET /auth/me` — Profil + Einstellungen.

**Security-Maßnahmen:**
- **API-Key-Verschlüsselung:** AES-256-GCM in `lib/crypto.ts`; `ENCRYPTION_KEY` = 32 Byte hex aus Env; pro Datensatz zufälliger IV; Format `iv:authTag:ciphertext`. Entschlüsselung ausschließlich im SyncService unmittelbar vor dem Provider-Call; Secrets tauchen in keiner API-Response auf (nur `keyPreview`), Logs maskiert.
- **Read-only-Hinweis:** UI-Anleitung beim Anlegen („nur Lese-Berechtigung vergeben"); `validateCredentials` ruft nur Lese-Endpoints.
- **Tenant-Isolation:** jede Query filtert auf `userId` aus dem JWT; Services nehmen `userId` als ersten Parameter — kein Pfad ohne.
- **Transport/Headers:** helmet; CORS-Allowlist aus Env (local: localhost-Ports + `capacitor://localhost`; prod: nur echte Domains, kein Wildcard).
- **Rate-Limiting:** express-rate-limit auf `/auth/*` (Brute-Force) und `/sources/*/sync` (Provider-Schonung).
- **Validierung:** jede Route hat ein Zod-Schema aus `packages/shared`; unbekannte Felder werden gestrippt.
- Generische Fehlermeldung bei Login-Fehlschlag (kein E-Mail-Enumeration-Leak).

## 13. Environment-Konzept (local / dev / prod)

**Variablen (api):** `NODE_ENV`, `APP_ENV` (local|dev|prod), `PORT`, `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `CORS_ORIGINS` (kommasepariert), `COINGECKO_API_KEY?`, `SOLANA_RPC_URL`.
**Variablen (mobile):** `VITE_API_URL`.

**Dateien:** `apps/api/.env` (local, gitignored), `.env.example` (committed, mit Platzhaltern), `apps/api/.env.dev.example` + `.env.prod.example` (vorbereitet, ohne echte Werte). `config/env.ts` validiert per Zod und erzwingt je `APP_ENV` unterschiedliche Regeln:

| | local | dev | prod |
|---|---|---|---|
| DB | Docker Compose, Default-Passwort ok | eigene URL, echte Secrets | Secret Manager (z.B. GCP), keine Defaults |
| Secrets | Defaults in `.env.example` erlaubt | generiert, in `.env.dev` | **Start verweigert**, wenn Secret fehlt/Default ist |
| CORS | localhost:5173, localhost:8100, capacitor://localhost | dev-Domain | exakte prod-Domains |
| Prisma | `migrate dev` | `migrate deploy` | `migrate deploy` |
| Logging | pretty, debug | json, info | json, warn; keine Bodies |

**docker-compose.yml:** `postgres:16-alpine`, Port 5432, benanntes Volume, healthcheck; optional Adminer auf 8080.

## 14. REST-API-Design (`/api/v1`)

```
POST   /auth/register · /auth/login · /auth/refresh · /auth/logout
GET    /auth/me                 PATCH /auth/me        # baseCurrency

GET    /portfolio/summary       # { totalEur, totalUsd, pricesFetchedAt,
                                #   byAsset[], bySource[], unmappedAssets[] }
GET    /holdings?groupBy=asset|source

GET    /sources                 # inkl. letzter SyncRun, keyPreview
POST   /sources                 # body je type: exchange{provider,apiKey,apiSecret,passphrase?}
                                #   | wallet{chain,address} | manual{label}
PATCH  /sources/:id             # label
DELETE /sources/:id             # + Holdings/Credentials (Cascade), Bestätigung im UI
POST   /sources/:id/sync        # 200 → SyncRun-Ergebnis; Fehler im Run, nicht als 500
POST   /sources/sync-all        # sequenziell, je Quelle isoliert; Sammel-Ergebnis
GET    /sources/:id/sync-runs?limit=20

POST   /sources/:id/holdings    # nur type=MANUAL: { assetId|symbol, quantity }
PATCH  /sources/:id/holdings/:holdingId
DELETE /sources/:id/holdings/:holdingId

POST   /imports                 # multipart: file, kind, sourceId? → Vorschau + Mapping-Vorschlag
POST   /imports/:id/mapping     # Mapping bestätigen → führt Import aus → Ergebnis
GET    /imports · /imports/:id  DELETE /imports/:id

GET    /assets/search?q=        # lokale Assets + CoinGecko-Suche
POST   /assets/:id/mapping      # { coingeckoId } — manueller Override
POST   /prices/refresh

GET    /health
```

Fehlerformat einheitlich: `{ error: { code: "INVALID_API_KEY", message: "...", details?: [...] } }` mit stabilen Codes, auf die das Frontend deutsche Texte mappt.

## 15. Sync-Flow

```
POST /sources/:id/sync
  1. Quelle laden (userId-Check); läuft bereits ein RUNNING-Run < 2 min → 409
  2. SyncRun(RUNNING) anlegen
  3. Credentials entschlüsseln / Adresse laden → Provider aus Registry
  4. provider.fetchBalances() — Timeout 30 s, 1 Retry bei Netzwerkfehler
  5. Normalisieren: RawBalance[] → Asset-Resolution (auto-create unmapped)
  6. DB-Transaktion: Holdings der Quelle vollständig ersetzen (delete + createMany)
     → Quelle spiegelt exakt den Provider-Stand, verschwundene Assets verschwinden
  7. price.service.refreshPrices(betroffene Asset-IDs)  — Fehler hier ≠ Sync-Fehler
  8. SyncRun → SUCCESS (oder ERROR mit errorCode/Message), lastSyncAt setzen
  9. Response: Run + aktualisierte Summary
```

`sync-all` iteriert sequenziell (schont Rate-Limits), sammelt Ergebnisse pro Quelle. CSV- und MANUAL-Quellen haben keinen Sync (Button ausgeblendet). **Queue-Vorbereitung:** Schritt 2–8 leben in `SyncService.syncSource(userId, sourceId)` ohne Express-Abhängigkeit — ein späterer BullMQ-Worker ruft exakt diese Funktion; der Endpoint würde dann nur enqueuen und das Frontend pollt den Run-Status (Polling-UI dafür existiert ab V1, da der Status sowieso angezeigt wird).

## 16. UI/UX-Konzept

- **Dashboard:** großer Gesamtwert (Umschalter EUR/USD per Tap), „Stand: vor 5 Min" + Sync-Button mit Spinner, Top-5-Assets, Banner bei Sync-Fehlern einzelner Quellen, Pull-to-Refresh.
- **Quellen:** Karten mit Provider-Icon, Label, Wert, `SyncStatusBadge` (grün ok / grau nie / rot Fehler mit Meldung). Add-Flow als Modal-Wizard: Typ → Provider → Formular mit Schritt-für-Schritt-Anleitung für read-only Keys.
- **CSV-Wizard:** 4 Screens (Upload → Mapping mit Live-Vorschau → Bestätigung → Ergebnis mit Fehlerzeilen-Liste, exportierbar).
- **Zustände konsequent:** jeder View hat Loading-Skeleton, Empty-State mit Call-to-Action und Error-State mit Retry.
- Onboarding nach Registrierung: leeres Dashboard mit drei Buttons „Quelle verbinden / CSV importieren / Manuell erfassen".

## 17. Testing-Konzept

- **Unit (Vitest, api):** `crypto.ts` (roundtrip, tamper), CSV-Parser/-Mapper (Komma-Dezimal, kaputte Zeilen, Mapping), Symbol-Normalisierung je Provider mit **Fixture-Dateien** echter API-Responses (keine Live-Calls in Tests), Asset-Resolution.
- **Integration (Vitest + Supertest):** Auth-Flow, Ownership (User A erreicht Quelle von User B → 404), Sync gegen gemockte Provider-Registry, CSV-Import end-to-end gegen Test-DB (eigene DB `crypto_tracker_test` im selben Docker-Postgres).
- **Frontend:** Vitest + Vue Test Utils für kritische Komponenten (CsvMappingTable, Stores mit gemocktem api.client). E2E (Playwright gegen Web-Build) erst nach MVP.
- **Ziel V1:** Geschäftslogik (csv/, providers/-Mapping, lib/crypto, sync.service) gut abgedeckt; UI-Snapshot-Tests bewusst keine.

## 18. Lokales Setup (Entwickler-Kommandos)

```bash
pnpm install
pnpm db:up           # docker compose up -d postgres
pnpm db:migrate      # prisma migrate dev   (--filter api)
pnpm db:seed         # Asset-Seed (Top-Coins + CoinGecko-IDs), Demo-User
pnpm dev:api         # Express auf :3000 (tsx watch)
pnpm dev:app         # Ionic/Vite auf :5173
pnpm dev             # beide parallel (concurrently)
pnpm db:studio       # Prisma Studio
pnpm test · pnpm lint · pnpm typecheck
# Native (später): pnpm --filter mobile cap:sync / cap:run:ios / cap:run:android
```

## 19. Feature-Priorisierung

→ siehe §3 (Muss / Sollte / Später / Bewusst nie). Innerhalb „Muss" ist die Reihenfolge der Umsetzungsplan in §20 — manuelle Bestände + Preise zuerst, weil damit Dashboard und Wertberechnung ohne externe Abhängigkeiten testbar sind.

## 20. Schritt-für-Schritt-Umsetzungsplan

| # | Meilenstein | Inhalt | Ergebnis |
|---|---|---|---|
| 0 | Fundament | Monorepo-Scaffold, pnpm Workspaces, TS-Configs, ESLint/Prettier, Docker Compose, Prisma init + erste Migration, `config/env.ts`, `/health`, Ionic-App-Skeleton mit Tabs | beide Apps starten lokal |
| 1 | Auth | User/RefreshToken-Models, auth-Modul, Middleware, shared-Schemas; Login/Register-Pages, auth.store, Guard, api.client mit Refresh | Login funktioniert end-to-end |
| 2 | Assets + manuelle Bestände + Preise | Asset/Holding/Source-Models, Seed, manual-Holdings-CRUD, CoinGecko-Client, portfolio/summary; Dashboard + Holdings-Page + Add-Manual-Flow | Portfolio mit echten EUR/USD-Werten |
| 3 | Sync-Gerüst | SyncRun, SyncService, Provider-Interfaces + Registry, sources-CRUD mit Verschlüsselung, Sync-Endpoints; SourcesPage + AddSourceModal + Status-Badges | Sync-Rahmen mit Dummy-Provider grün |
| 4 | Wallets | Bitcoin- (mempool.space) + Solana-Provider (RPC, SPL via Mint-Mapping) | Wallet-Adresse verbinden → Bestand erscheint |
| 5 | Exchanges I | Kraken + Bitvavo (HMAC, Symbol-Normalisierung, Fixtures) | echte Exchange-Bestände |
| 6 | CSV-Import | csv-Modul, Upload/Mapping/Execute, Wizard-UI, Import-Historie | generische CSV importierbar inkl. Fehlerzeilen |
| 7 | Polish | Dark/Light-Toggle, Settings, Empty/Error-States, Onboarding, Fehlertexte | V1 „Muss" komplett |
| 8 | Exchanges II + Sollte | Coinbase, Bitpanda, CSV-Transaktionen, Allocation-Chart | „Sollte"-Umfang |
| 9 | Native | Capacitor-Konfiguration, iOS/Android-Builds, Secure-Storage-Check, Safe-Areas | App läuft auf Gerät |

Jeder Meilenstein endet lauffähig und getestet; Tests entstehen im jeweiligen Meilenstein, nicht am Ende.

## 21. Risiken und offene Fragen

**Risiken:**
1. **CoinGecko-Rate-Limit** (ohne Key ~5 req/min) — Mitigation: Batching, 60s-Cache, kostenloser Demo-Key; trotzdem die größte externe Abhängigkeit.
2. **Symbol-Kollisionen** (gleiches Ticker-Symbol, verschiedene Coins) — Mitigation: Symbol nicht unique, kuratierter Seed, Mint-/Contract-basiertes Mapping bei Solana, manueller Override. Restrisiko: falscher Preis bei exotischen Coins.
3. **Exchange-API-Drift** (besonders Coinbase-Key-Formate ändern sich) — Mitigation: Provider isoliert + Fixtures; Doku-Check unmittelbar vor Implementierung des jeweiligen Providers.
4. **Refresh-Token im localStorage (Web)** — für lokales V1 akzeptiert; vor echtem prod-Deployment auf httpOnly-Cookie-Variante für Web umstellen (Architektur lässt beides zu).
5. **Solana-RPC-Zuverlässigkeit** (öffentliche Endpoints drosseln) — Env-konfigurierbarer RPC, später eigener Key (Helius o.ä.).
6. **Decimal-Fallen** — durchgehend String/Prisma.Decimal; Reviews achten auf versehentliches `parseFloat`.

**Offene Fragen (blockieren den Start nicht):**
- Bitcoin xpub-Support (viele Nutzer haben HD-Wallets mit wechselnden Adressen) — bewusst „Später", aber früh nachgefragt werden wird es vermutlich.
- Fiat-Bestände auf Exchanges (EUR auf Kraken): V1 ignoriert sie; alternativ als „Asset" mit Preis 1.0 aufnehmen → Entscheidung in Meilenstein 5.
- Bitpanda-API-Umfang ist begrenzt; falls unbrauchbar, fällt Bitpanda auf CSV-Import zurück.

## 22. Konkrete nächste Aufgaben

1. Repo `crypto-tracker` anlegen, Meilenstein 0 umsetzen (Scaffold, Docker, Prisma, Skeleton-Apps).
2. Meilenstein 1 (Auth) — danach existiert der vertikale Durchstich App↔API↔DB.
3. Parallel: kostenlosen CoinGecko-Demo-Key besorgen; Kraken-/Bitvavo-Testaccounts mit read-only Keys für Meilenstein 5 vorbereiten.

## Verifikation

- Nach jedem Meilenstein: `pnpm test`, `pnpm typecheck`, `pnpm lint` grün.
- End-to-End lokal: `pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm dev` → Registrierung → manuelle BTC-Position anlegen → Dashboard zeigt EUR/USD-Wert → Wallet-Adresse verbinden → Sync → Bestand sichtbar → CSV mit absichtlichen Fehlerzeilen importieren → Fehlerliste korrekt.
- Security-Check: API-Response von `GET /sources` darf nie Key/Secret enthalten; DB-Inspektion zeigt nur Ciphertext; Zugriff auf fremde Quelle liefert 404.
