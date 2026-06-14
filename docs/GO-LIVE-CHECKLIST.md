# Go-Live-Checkliste

> Was vor dem Produktivgang erledigt sein muss, damit die App auf prod sicher und
> funktionsfähig läuft. Stand: 14.06.2026. Querverweise:
> [APP-STORE-READINESS](./legal/APP-STORE-READINESS.md) · [AGB](./legal/AGB.md) ·
> [DATENSCHUTZ](./legal/DATENSCHUTZ.md) · [IMPLEMENTATION-STATE](./IMPLEMENTATION-STATE.md)

## 1. Infrastruktur & Deployment

- [ ] **Hosting entschieden** (VPS / Fly.io / Render / GCP …) für API + statische Web-App.
- [ ] **Managed PostgreSQL** (Backups + PITR aktiviert), `DATABASE_URL` gesetzt.
- [ ] API-Build & Migrationen: `pnpm --filter @crypto-tracker/api build`, dann
      `prisma migrate deploy` (NICHT `migrate dev`/`reset` auf prod).
- [ ] Web-App-Build: `pnpm --filter @crypto-tracker/mobile build` → `dist/` hinter Reverse-Proxy
      (nginx/Caddy) mit **HTTPS**.
- [ ] **Reverse-Proxy/HTTPS** terminiert; HTTP→HTTPS-Redirect; sinnvolle Security-Header (helmet ist aktiv).
- [ ] Optional: **Redis** + Worker-Prozess (`dev:worker`) für Background-Sync/Preis-Cron, falls genutzt
      (`REDIS_URL`).

## 2. Secrets & Environment (`APP_ENV=prod`)

- [ ] **Echte Secrets generieren** (nicht die `.env.example`-Defaults — der Start verweigert sie sonst):
      `openssl rand -base64 32` für `JWT_SECRET`/`JWT_REFRESH_SECRET`, `openssl rand -hex 32` für `ENCRYPTION_KEY`.
- [ ] Secrets aus **Secret Manager** injizieren, nicht als Datei aufs Image.
- [ ] **`CORS_ORIGINS`** = exakte prod-Domain(s), kein `localhost`, kein Wildcard (Start verweigert localhost in prod).
- [ ] **`APP_PUBLIC_URL`** = prod-Web-URL (für Passwort-Reset- und Stripe-Redirect-Links).
- [ ] `FAKE_PRICES`/`FAKE_PROVIDERS` **nicht** gesetzt (in prod ohnehin blockiert).
- [ ] **`ENCRYPTION_KEY` sichern/rotierbar dokumentieren** — Verlust = alle hinterlegten Exchange-Secrets unlesbar.

## 3. Auth & Sicherheit

- [ ] **httpOnly-Refresh-Cookie in prod**: `Secure` ist automatisch aktiv (`APP_ENV!==local`). Sicherstellen,
      dass Web-App und API **same-site** sind (gleiche Domain/Subdomain) — sonst Cookie auf `SameSite=None`
      umstellen (in `refresh-cookie.ts`) und CORS-Credentials prüfen.
- [ ] **SMTP konfigurieren** (`SMTP_HOST` etc.), sonst landet der Passwort-Reset-Link nur im Server-Log.
- [ ] Auth-Rate-Limit greift in prod (20/15min) — ggf. an Lastprofil anpassen.
- [ ] Read-only-Hinweis bei Exchange-Keys steht; sicherstellen, dass keine Default-Secrets in Logs landen.

## 4. Externe APIs

- [ ] **CoinGecko-API-Key** (`COINGECKO_API_KEY`) setzen — ohne Key trifft Markt/Verlauf das Rate-Limit
      (liefert dann Cache/leer, nie 500, aber unzuverlässig gefüllt).
- [ ] Optional `BEACONCHAIN_API_KEY` (ETH-Validator-Rewards), `ETH_RPC_URL`, `SOLANA_RPC_URL`,
      `MEMPOOL_API_URL` auf belastbare/eigene Endpunkte zeigen lassen (öffentliche RPCs sind rate-limitiert).
- [ ] Praxistest mit **echten read-only Exchange-Keys** (Kraken/Bitvavo …) — bisher nur Fixtures/Signaturtests.

## 5. Billing (Stripe / Abo)

- [ ] Stripe-Account + **Produkt/Preis** anlegen → `STRIPE_PRICE_ID`.
- [ ] `STRIPE_SECRET_KEY` (live) + `STRIPE_WEBHOOK_SECRET` setzen; `STRIPE_SUCCESS_URL`/`STRIPE_CANCEL_URL`.
- [ ] **Webhook-Endpoint** `POST /api/v1/billing/webhook` in Stripe registrieren (öffentlich erreichbar);
      Events `checkout.session.completed`, `customer.subscription.updated|deleted`.
- [ ] Ende-zu-Ende-Test: Checkout → Webhook → `User.plan = PRO`; Kündigung → `FREE`.
- [ ] **Native IAP (Apple/Google)** — Pflicht für Abos in den Store-Builds (Stripe nur Web). Noch offen.

## 6. Native Apps (Capacitor)

- [ ] **Echte App-Icons/Splash** statt Platzhalter (`apps/mobile/assets/` ersetzen, `cap:assets` laufen lassen).
- [ ] **Android**: Build mit JDK 17+ + Android-SDK; Release-Build **ohne** Cleartext-Ausnahme; signierter Keystore.
- [ ] **iOS**: `cap add ios` + Build auf macOS/Xcode.
- [ ] `VITE_API_URL` im Native-Build auf die **prod-HTTPS-API** (keine LAN-IP/Cleartext).
- [ ] **Store-Pflichten**: In-App-Konto-Löschung ✔ vorhanden; für Google zusätzlich **öffentliche
      Web-URL zur Konto-Löschung**. Privacy-Labels (Apple) / Data-Safety (Google), Financial-Features-Deklaration.

## 7. Recht & Compliance

- [ ] **AGB + Datenschutzerklärung** anwaltlich prüfen lassen und unter öffentlichen URLs veröffentlichen
      (Entwürfe in `docs/legal/`).
- [ ] **Impressum** (DE/AT-Pflicht) ergänzen.
- [ ] Steuer-Disclaimer „Keine Steuerberatung" ist in App + PDF vorhanden — vor Bezahlfunktion nochmal prüfen.
- [ ] Cookie-/Consent-Hinweis (technisch notwendiges Session-Cookie — i.d.R. ohne Consent, dokumentieren).

## 8. Qualität & Betrieb

- [ ] **CI/CD**: Pipeline für `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` vor jedem Deploy.
- [ ] **Monitoring/Logging** (Fehler-Tracking z.B. Sentry, Uptime-Check auf `/api/v1/health`).
- [ ] **DB-Backups** + Restore getestet.
- [ ] Lasttest der CoinGecko-/Provider-Pfade (Rate-Limits, Caching).

## 9. Bekannte funktionale Lücken (kein Blocker, bewusst offen)

- Automatischer Background-Sync je Nutzer existiert noch nicht (nur manueller Sync + Preis-Cron) —
  ist als Pro-Feature beworben, müsste vor Bewerbung gebaut/erzwungen werden.
- Laufende PnL/Kostenbasis-Anzeige im Portfolio fehlt (nur im Steuerreport).
- AT-Steuerreport nutzt globale Pools (dokumentierte Vereinfachung); Crypto-zu-Crypto-Swaps/FX nicht abgebildet.
- Exchange-Provider decken nur Spot/Hauptkonto ab (kein Earn/Margin/Futures, außer Kraken-Staking/Binance-Flexible).
