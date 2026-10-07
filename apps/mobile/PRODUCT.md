# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Ionic Vue app, shipped as mobile web and wrapped with Capacitor 8 (Android project checked in, iOS planned). One unified design language across devices — no per-OS adaptive styling — but native affordances are respected: safe areas, back-swipe, keyboard resize, status bar, haptics where available.

## Users

Private crypto holders in DACH/EU whose holdings are spread across several exchanges, wallets and manual positions. Typical moment: a quick look at the phone to know "how much do I have and what changed" — then, less often, maintaining sources (connect, sync, import) and digging into allocation, history or single assets.

## Product Purpose

A calm, read-only overview of a personal crypto portfolio: balances from exchanges (read-only API keys), wallets (public addresses), CSV imports and manual entries, valued in EUR or USD. Success means the user trusts the total at a glance and can trace any number back to where it came from — without trading noise.

## Positioning

"Ruhig, ehrlich, nachvollziehbar – dein Krypto-Vermögen ohne Trading-Lärm." It should feel like a wealth/banking overview, not an exchange app. Three mechanisms neighbors cannot truthfully copy as a bundle:

1. **Provenance** — every holding belongs to exactly one source (`PortfolioSource`), so each number is traceable to its exchange, wallet, import or manual bucket.
2. **Data-minimal and read-only** — no trading, no withdrawals, read-only keys, encrypted secrets, privacy mode that hides amounts.
3. **DE/AT tax report** with multiple tax entities (portfolios per tax subject), CSV/PDF export.

## Operating Context

- Glance first: dashboard total + change, pull-to-refresh, privacy toggle for public places.
- Source maintenance is the onboarding bottleneck: add exchange/wallet, CSV import wizard, manual holdings; sync status and provider errors must be understandable and recoverable.
- Analysis second: value chart (24h/7d/30d, 1y Pro), allocation, holdings grouped by account type (spot/earn/margin/futures), market lists, transactions with transfer/swap linking.
- Admin broadcasts (announcements, surveys) and a force-update gate appear inside the app.

## Capabilities and Constraints

- Freemium: Free = 2 portfolios, 5 sources, 30-day history. Pro = unlimited, tax report, 1-year history, auto-sync. Referral program (20% recurring) with payouts.
- Money is never float; amounts arrive as strings. Values in EUR/USD via CoinGecko.
- Six locales (de, en, fr, pl, cs, ru); German copy uses "du". Layouts must survive the longest strings (ru, fr) by wrapping, not truncating labels.
- E2E contract: `data-testid`s stay stable and tests are never weakened; where structure deliberately changes, tests are updated in the same commit. Tests run in `de-DE` against the web build.
- Redesign scope: visuals and information architecture/flows of `apps/mobile`; functions stay the same; backend changes only when the UX strictly requires them. `apps/admin` is out of scope.

## Brand Commitments

- Working name "Crypto Tracker" / "Crypto Tracker Pro" — kept as working title; logo/app icon is a placeholder and may be redrawn as a simple, replaceable mark.
- Voice: factual-friendly, "du" in German, no hype, no trading jargon.

## Evidence on Hand

- No real testimonials, user counts, or press. Do not fabricate any.
- Exchange happy paths verified via fixtures only; supported exchanges/chains are exactly those registered in `apps/api/src/providers/provider.registry.ts` — never claim more.
- Holding movements (`GET /movements`) exist from the first sync/import after the `holding_movements` migration; older history does not exist and must not be implied.

## Product Principles

1. **Trust over excitement** — calm presentation of money; gains/losses are information, not alarms.
2. **Every number has a source** — provenance is always one tap away.
3. **Glance, then depth** — the answer to "how much / what changed" comes first; maintenance and analysis are layered behind it.
4. **Pro appears where the limit is** — contextual lock + paywall sheet and a quiet settings entry; no recurring upsell cards.
5. **Errors are recoverable** — every failure state says what happened and what to do next.

## Accessibility & Inclusion

WCAG 2.2 AA as the floor, plus:

- touch targets ≥ 44px; pinch zoom must not be blocked;
- layouts hold up to 200% system text size;
- `prefers-reduced-motion` respected;
- gain/loss never by color alone (sign and/or arrow always present);
- amounts and charts carry meaningful screen-reader text;
- visible focus states; light and dark mode both first-class.
