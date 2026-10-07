---
version: 1
slug: "src-views-dashboardpage-vue"
primary_target: "src/views/DashboardPage.vue"
related_targets: ["src/views/HoldingsPage.vue","src/views/sources/SourcesPage.vue","src/views/MarketPage.vue","src/views/SettingsPage.vue"]
---

# Surface brief — Crypto Tracker mobile app (all authenticated + auth screens)

Mode: Operate. Audience/job/constraints: see apps/mobile/PRODUCT.md. Build path: code-led (no image generation).

## Direction contract

THESIS: The app reads like a Depotauszug: positions per source add up visibly over a double rule (Summenstrich) to the Saldo, followed by booked movements. It refuses the category default of navy card stacks (total card, donut card, chart card) and any trading-terminal energy.

OWN-WORLD: Light = cool statement paper (#EEF2EF ground, #F8FAF8 sheet, #14201B ink, #C5CFC9 hairline rules); dark = night statement (#0F1714 ground, #16201C sheet, #E6ECE8 ink). One bank-stamp blue (#2546A8 / dark #93AAFF) for actions and selection only. Gain/loss: deep green/red, always with sign and arrow. Golos Text for all UI text; Martian Mono for every amount, quantity and date column (data, never decoration). Hairline rows, right-aligned figures, no cards-in-cards, no shadows except sheets/modals.

STORY: The user opens the app, reads the Saldo and what changed, sees which source holds what, and sees what was booked since last time; one tap reaches any number's origin (source, asset detail with per-source lines and running quantity balance).

FIRST VIEWPORT: Top bar: portfolio switcher left; privacy toggle and profile avatar right. Below: "Saldo" label with "Stand <date, time>", the Saldo in Martian Mono at 2.25rem, change line (arrow + signed amount + percent, range chips 24h/7d/30d/1y). One thin value line chart. Then the "Positionen" statement: one row per source (name, sync state mark, value right-aligned), double rule, bold Saldo row. Primary action "Hinzufügen" lives in the empty state and the Quellen tab header, never as floating chrome on the overview. Bottom tab bar: Übersicht · Bestände · Quellen · Markt.

FORM: Kontoauszug (own grounded list position 1, IMPECCABLE'S PICK chosen by the user over the rolled candidate 3 "Banknote"); seed key 7a2b635a. Signature move: the Summenstrich statement — positions summing to the Saldo — reused for asset detail (per-source lines → total quantity) and the movements list (day-grouped booking lines with running quantity balance). Signature interaction: tapping a position focuses it (others dim) and filters the movements to that source; freshly booked lines carry a brief paper-highlight on arrival (reduced motion: static marker).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Constraints for this surface
- data-testids stay stable; E2E tests updated in the same commit only where structure deliberately changes.
- 6 locales, longest ru/fr — wrap, never truncate labels.
- WCAG 2.2 AA floor + PRODUCT.md accessibility list.
