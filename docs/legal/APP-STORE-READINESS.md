# App-Store-Readiness (Apple App Store + Google Play)

> Stand: [Datum] · Statushinweise beziehen sich auf den aktuellen Code-Stand.
> Ein read-only Krypto-**Portfolio-Tracker** (kein Handel, keine Verwahrung) ist
> grundsätzlich zulässig — die folgenden Punkte sind vor Einreichung zu klären.

## Krypto-spezifische Store-Regeln

- **Apple (Guideline 3.1.5 / 3.2.1):** Apps für Krypto dürfen Wallets/Exchanges nur anbieten,
  wenn der Anbieter entsprechend organisiert/lizenziert ist. **Wir fallen NICHT darunter**, weil
  die App rein **read-only** ist: kein Handel, keine Ein-/Auszahlungen, keine Verwahrung, kein
  On-Device-Mining. In der Review-Notiz klar als „read-only portfolio tracker" deklarieren.
- **Google Play (Financial Features / Crypto):** „Crypto Exchanges & Wallets"-Deklaration im
  Play Console-Formular ausfüllen; da wir **nicht** handeln/verwahren, i. d. R. keine
  Lizenz-Nachweise nötig — Deklaration trotzdem korrekt setzen.
- Keine irreführenden Renditeversprechen, keine „garantierten Gewinne", keine Token-Promotion.

## Pflicht: In-App-Konto-Löschung  ⛔ **offen (Code-Lücke)**

Apple **und** Google verlangen: wer ein Konto anlegen kann, muss es **in der App** löschen können
(Google zusätzlich: Web-Link zur Löschung). **Aktuell fehlt** ein Account-Lösch-Endpunkt
(es gibt nur Logout + Portfolio-Löschung). **To-do:** `DELETE /auth/me` (löscht User + per Cascade
Portfolios/Quellen/Holdings/Transaktionen/Tokens) + UI in den Einstellungen + öffentliche
Lösch-Info-Seite.

## Zahlungen (falls Pro-Abo)

- **Apple:** digitale Abos müssen über **In-App-Purchase / StoreKit** laufen (15–30 %).
- **Google:** **Play Billing** für digitale Abos.
- Stripe o. Ä. nur für echte Web-App, nicht in den nativen Builds für digitale Inhalte.

## Datenschutz & Transparenz

- **Privacy Policy URL** öffentlich erreichbar (→ `docs/legal/DATENSCHUTZ.md` veröffentlichen).
- **Apple App Privacy** („Nutrition Label"): Datenarten deklarieren — E-Mail (Account),
  Finanz-/Nutzungsdaten (Bestände), keine Tracking-Nutzung, keine Weitergabe zu Werbung.
- **Google Play Data Safety**-Formular: gleiche Angaben; Verschlüsselung at-rest/in-transit angeben.
- **Account-Daten:** Verschlüsselung dokumentieren (argon2-Hash, AES-256-GCM-Secrets,
  httpOnly-Cookie / Keychain-Keystore).

## Technisch / Sonstiges

- **HTTPS/ATS:** nativer Build muss gegen eine **https**-Prod-API laufen (kein Cleartext;
  die Dev-LAN-Cleartext-Ausnahme NICHT in den Release-Build).
- **Support-Kontakt** + **AGB-URL** (→ `docs/legal/AGB.md`).
- **Alters-/Inhaltsfreigabe** (Apple Rating / Google Content Rating): Finanz-App, i. d. R. 17+/„hoch"
  prüfen.
- **Login:** E-Mail/Passwort — „Sign in with Apple" ist **nicht** verpflichtend, solange kein
  Dritt-/Social-Login angeboten wird.
- **App-Icon/Splash:** Platzhalter ersetzen (`apps/mobile/assets/`), `cap:assets` laufen lassen.
- **Berechtigungen:** nur nötige (Netzwerk); keine Standort-/Kontakte-/Tracking-Permissions.

## Reihenfolge vor Einreichung

1. **Konto-Löschung** implementieren (Pflicht, Code).
2. Prod-Deployment der API über **https** + echte Domain; `httpOnly`-Cookie `Secure`.
3. AGB + Datenschutz veröffentlichen (URLs).
4. Store-Formulare (App Privacy / Data Safety / Financial Features) ausfüllen.
5. Echte Icons; Release-Build ohne Cleartext-Ausnahme.
6. (Falls Pro) IAP/Play-Billing integrieren.
