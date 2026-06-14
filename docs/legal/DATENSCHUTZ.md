# Datenschutzerklärung

> ⚠️ **Vorlage / Entwurf — keine Rechtsberatung.** Vor Veröffentlichung anwaltlich /
> mit einem Datenschutzbeauftragten prüfen lassen. Platzhalter in `[eckigen Klammern]` ausfüllen.

**Verantwortlicher (Art. 4 Nr. 7 DSGVO):** [Name / Firma], [Anschrift], [E-Mail] ·
Stand: [Datum]

## 1. Überblick

Die App „Crypto Tracker" verarbeitet personenbezogene Daten, um Krypto-Portfolios read-only
zu bündeln und zu bewerten. Es werden **keine Daten verkauft** und keine Daten zu Werbezwecken
an Dritte weitergegeben.

## 2. Verarbeitete Daten

- **Konto:** E-Mail-Adresse, Passwort (nur als argon2-Hash gespeichert), Basiswährung, Spracheinstellung.
- **Quellen/Bestände:** Exchange-API-Keys (read-only, **AES-256-GCM-verschlüsselt** gespeichert; die
  App zeigt nur eine `…1234`-Vorschau), öffentliche Wallet-Adressen, importierte/erfasste Bestände
  und Transaktionen, Portfolio-Struktur.
- **Technisch:** Session-/Refresh-Token (Web: httpOnly-Cookie; nativ: verschlüsselter
  Geräte-Speicher), Server-Logs (IP, Zeitstempel, ggf. Fehlermeldungen).
- **Zahlung (falls Pro-Abo):** abgewickelt über [Apple/Google/Stripe]; Zahlungsdaten verarbeitet
  der jeweilige Anbieter, nicht der Verantwortliche.

## 3. Zwecke & Rechtsgrundlagen

- Bereitstellung des Kontos und der Tracking-Funktionen — Vertragserfüllung, **Art. 6 Abs. 1 lit. b DSGVO**.
- Sicherheit, Missbrauchs-/Fehlerabwehr, Logs — berechtigtes Interesse, **Art. 6 Abs. 1 lit. f DSGVO**.
- Zahlungsabwicklung bei Pro-Abo — Vertragserfüllung, **Art. 6 Abs. 1 lit. b DSGVO**.

## 4. Empfänger / Drittanbieter

- **CoinGecko** — Abruf von Kurs-/Marktdaten (es werden keine Kontodaten übermittelt, nur
  Coin-IDs/Währung).
- **Exchanges/Blockchain-APIs** (Kraken, Bitvavo, … bzw. mempool.space, Blockchair, RPCs) — Abruf
  der Bestände zu den vom Nutzer hinterlegten Keys/Adressen.
- **Hosting:** [Hosting-Anbieter / Region].
- **Zahlungsdienstleister:** [Apple/Google/Stripe], falls Pro genutzt wird.

Mit Auftragsverarbeitern werden, soweit erforderlich, AV-Verträge nach **Art. 28 DSGVO**
geschlossen. Bei Drittlandtransfers werden geeignete Garantien (z. B. EU-Standardvertragsklauseln)
sichergestellt.

## 5. Speicherdauer & Löschung

Kontodaten werden bis zur Löschung des Kontos gespeichert. Der Nutzer kann sein Konto und alle
zugehörigen Daten jederzeit löschen ([Funktion/Weg ergänzen]); danach werden die Daten gelöscht,
soweit keine gesetzlichen Aufbewahrungspflichten entgegenstehen. Server-Logs werden nach
[Zeitraum] gelöscht.

## 6. Sicherheit

Passwörter werden nur als argon2-Hash gespeichert, Exchange-Secrets AES-256-GCM-verschlüsselt.
Der Web-Refresh-Token liegt in einem httpOnly-Cookie, nativ im Keychain/Keystore. Zugriff auf
fremde Ressourcen wird serverseitig unterbunden.

## 7. Rechte der betroffenen Person

Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung (Art. 18),
Datenübertragbarkeit (Art. 20), Widerspruch (Art. 21) sowie Beschwerde bei einer
Aufsichtsbehörde (Art. 77). Kontakt: [E-Mail].

## 8. Cookies

Es wird ein technisch notwendiges **httpOnly-Session-Cookie** zur Anmeldung gesetzt
(keine Tracking-/Werbe-Cookies). Rechtsgrundlage: Art. 6 Abs. 1 lit. b/f DSGVO bzw.
§ 25 Abs. 2 TTDSG (unbedingt erforderlich).
