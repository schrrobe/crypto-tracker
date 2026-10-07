---
name: Crypto Tracker
description: A calm, read-only crypto portfolio that reads like a bank statement (Kontoauszug).
colors:
  statement-ground: "#eef2ef"
  statement-sheet: "#f9fbf9"
  ink: "#14201b"
  ink-secondary: "#46564e"
  ink-tertiary: "#5a6a62"
  hairline-rule: "#c9d3cd"
  control-rule: "#7f8d86"
  bank-stamp-blue: "#2546a8"
  bank-stamp-blue-on: "#ffffff"
  bank-stamp-blue-soft: "#e3e9f8"
  booked-gain: "#17663f"
  booked-loss: "#b42318"
  caution-ochre: "#7a5100"
  caution-ochre-soft: "#f6ecd6"
  loss-soft: "#f8e4e1"
  highlighter: "#fff1b0"
  series-1-stamp-blue: "#2546a8"
  series-2-petrol: "#1c6e73"
  series-3-ochre: "#a0701a"
  series-4-aubergine: "#7a3b69"
  series-5-slate: "#4f5d8a"
  series-rest: "#aab6b0"
  backdrop: "#0b120f"
  night-ground: "#0e1513"
  night-sheet: "#151e1a"
  night-ink: "#e4ebe7"
  night-ink-secondary: "#a9b8b0"
  night-ink-tertiary: "#8fa098"
  night-rule: "#2c3833"
  night-control-rule: "#66756e"
  night-stamp-blue: "#9db2ff"
  night-stamp-blue-on: "#0e1513"
  night-stamp-blue-soft: "#1f2944"
  night-gain: "#63c98f"
  night-loss: "#ff8b7e"
  night-warn: "#e8b65a"
  night-warn-soft: "#2e2716"
  night-loss-soft: "#3a1f1c"
  night-highlighter: "#3b3518"
  night-series-1: "#9db2ff"
  night-series-2: "#5cc2c7"
  night-series-3: "#e0b25e"
  night-series-4: "#d08ac0"
  night-series-5: "#a3add6"
  night-series-rest: "#4a5852"
typography:
  saldo:
    fontFamily: "'Martian Mono Variable', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "clamp(1.625rem, 8.4vw, 2.25rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.03em"
    fontVariation: "'wdth' 80"
    fontFeature: "'tnum' 1"
  headline:
    fontFamily: "'Golos Text Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 650
    letterSpacing: "-0.01em"
  title:
    fontFamily: "'Golos Text Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 650
  section:
    fontFamily: "'Golos Text Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 650
  body:
    fontFamily: "'Golos Text Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
  row-label:
    fontFamily: "'Golos Text Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 550
  secondary:
    fontFamily: "'Golos Text Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  label:
    fontFamily: "'Golos Text Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
  figure:
    fontFamily: "'Martian Mono Variable', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "1rem"
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 80"
    fontFeature: "'tnum' 1"
rounded:
  tag: "4px"
  control: "6px"
  sheet: "10px"
  modal: "14px"
  pill: "50%"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
  touch: "44px"
  row: "56px"
  page-max: "640px"
components:
  sheet:
    backgroundColor: "{colors.statement-sheet}"
    rounded: "{rounded.sheet}"
  statement-row:
    textColor: "{colors.ink}"
    typography: "{typography.row-label}"
    padding: "8px 16px"
    height: "56px"
  statement-row-focused:
    backgroundColor: "{colors.bank-stamp-blue-soft}"
  statement-total:
    textColor: "{colors.ink}"
    padding: "12px 16px"
  statement-day:
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    padding: "12px 16px 4px"
  button-primary:
    backgroundColor: "{colors.bank-stamp-blue}"
    textColor: "{colors.bank-stamp-blue-on}"
    rounded: "{rounded.control}"
    height: "44px"
  tag:
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "1px 6px"
  notice-warn:
    backgroundColor: "{colors.caution-ochre-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "12px 16px"
  notice-error:
    backgroundColor: "{colors.loss-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "12px 16px"
  notice-info:
    backgroundColor: "{colors.bank-stamp-blue-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "12px 16px"
  chip:
    backgroundColor: "{colors.bank-stamp-blue-soft}"
    textColor: "{colors.bank-stamp-blue}"
    height: "44px"
  tab-bar:
    backgroundColor: "{colors.statement-sheet}"
    textColor: "{colors.ink-secondary}"
    height: "56px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.statement-ground}"
    rounded: "{rounded.sheet}"
---

# Design System: Crypto Tracker

## Overview

**Creative North Star: "The Kontoauszug"**

The app reads like a bank statement. Positions per source are listed as hairline rows on a paper sheet and add up visibly over a double rule (the Summenstrich) to a bold total, the Saldo; booked movements follow as day-grouped lines with a running balance. The same statement grammar repeats everywhere a number has an origin: the overview's positions, an asset's per-source lines summing to its total quantity, the movements list. Provenance is a visual habit, not a feature screen.

The world is cool statement paper (light) and a night statement (dark), both first-class. Ink does almost all the work; one bank-stamp blue marks what can be acted on, selected or focused, and nothing else. Every amount, quantity and date sits in a condensed monospace figure face, right-aligned, so columns line up the way they do on a printed Auszug. Density is that of a statement: generous row height (56px) for touch, little decoration, no cards stacked inside cards, no shadows on content.

It deliberately refuses the category default: navy card stacks (total card, donut card, chart card), neon trading-terminal energy, and alarm-coloured P/L. Gains and losses are information, carried by sign and arrow first and colour second.

**Key Characteristics:**
- Statement sheets with hairline rows; totals over a 3px double rule.
- Martian Mono at 80% width for every figure; Golos Text for every word.
- One accent (bank-stamp blue) for action, selection and focus only.
- Gain/loss always signed; quantity deltas never coloured.
- Flat: depth comes from ground-vs-sheet tone and hairlines, not shadows.
- One authored motion moment: the highlighter pass over a freshly booked line.

## Colors

A cool, faintly green-grey paper with near-black green ink, one institutional blue, and print-ink data colours that never borrow from gain/loss.

### Primary
- **Bank-Stamp Blue** (bank-stamp-blue; night: night-stamp-blue): primary buttons, links, section links, selected tab, caret, selection tint (22% alpha), the single focus ring, and chip text. Its soft wash (bank-stamp-blue-soft) is the focused statement row, info notices, chips and the add-option glyph discs. Never used as decoration.

### Secondary
- **Booked Gain** (booked-gain; night: night-gain): positive value changes and P/L, the "ok" sync mark.
- **Booked Loss** (booked-loss; night: night-loss): negative value changes and P/L, the "error" mark, error-state icon. Its soft wash (loss-soft) is the error notice ground.
- **Caution Ochre** (caution-ochre; night: night-warn): the "warn" mark and warning icons. Its soft wash (caution-ochre-soft) is the default notice ground.
- **Highlighter** (highlighter; night: night-highlighter): only the fresh-line pass on a newly booked movement.

### Tertiary (data series)
- **Allocation inks** (series-1-stamp-blue, series-2-petrol, series-3-ochre, series-4-aubergine, series-5-slate, then series-rest for "other"): the allocation bar and its legend, cycling 1 to 5. Series 1 shares the accent hue; that is the one place blue appears as data.

### Neutral
- **Statement Ground** (statement-ground / night-ground): page, toolbar, modal content and ion-content background.
- **Statement Sheet** (statement-sheet / night-sheet): sheets, inset lists, cards, tab bar, overlays.
- **Ink** (ink / night-ink): all primary text, the Summenstrich rule, the value-chart line (area fill at 5% opacity), the avatar disc, toast ground.
- **Ink Secondary** (ink-secondary / night-ink-secondary): sub-lines, day headings, notes, unselected tabs, tags, hints.
- **Ink Tertiary** (ink-tertiary / night-ink-tertiary): placeholders, chevrons, the quietest market metadata.
- **Hairline Rule** (hairline-rule / night-rule): row separators, sheet borders, toolbar and tab-bar borders, scrollbars.
- **Control Rule** (control-rule / night-control-rule): borders of interactive controls and tags; chosen to reach 3:1 against the sheet (WCAG 1.4.11).

### Named Rules
**The Sign-First Rule.** Every gain/loss figure carries an explicit sign (+ or the true minus −) and, on headline changes, an up/down arrow plus screen-reader word; colour is the third signal, never the only one. Changes under 0.05% render flat in ink-secondary, never as a green "+0.0 %".

**The Uncoloured Quantity Rule.** Quantity deltas in booking lines (+0.5 BTC, −120 SOL) are signed but stay ink. A transfer in is not a gain; only value changes get gain/loss colour.

**The One Stamp Rule.** Bank-stamp blue means "you can act here, or this is selected/focused". It is never a background panel, a decorative stroke, or a chart line.

**The Print Ink Rule.** Data series use print inks (blue, petrol, ochre, aubergine, slate); never green or red, so allocation never reads as performance.

## Typography

**UI Font:** Golos Text Variable (with system-ui, -apple-system, Segoe UI, Roboto)
**Figure Font:** Martian Mono Variable at font-stretch 80% (with ui-monospace, SF Mono, Menlo)

**Character:** Golos is a plain, sturdy grotesk with good Cyrillic coverage for the six locales; Martian Mono, narrowed to 80%, gives figures the fixed-pitch, tabular discipline of a printed statement without eating the row width.

### Hierarchy
- **Saldo** (Martian Mono 600, clamp(1.625rem, 8.4vw, 2.25rem), line-height 1.15, -0.03em): the portfolio total on the overview, only.
- **Headline** (Golos 650, 1.375rem): empty-state and modal-sheet headings; the same size carries an asset's total quantity (in figures, 600).
- **Title** (Golos 650, 1.125rem): toolbar titles, card titles, statement total figure size.
- **Section** (Golos 650, 1rem): section heads above sheets; sheet titles drop to 0.875rem.
- **Body / Row label** (Golos 400 / 550, 1rem): running text; statement-row labels at 550.
- **Secondary** (Golos 400, 0.875rem): row sub-lines, notices, change line, section links (550).
- **Label** (Golos 600-650, 0.75rem): tags, marks, day headings (+0.02em tracking), tab labels, hints, chart axis.

The rem scale is fixed (ratio about 1.2: 0.75 / 0.875 / 1 / 1.125 / 1.375) so it scales with system text size up to 200%. Headings h1-h3 balance-wrap and track -0.01em.

### Named Rules
**The Figures Rule.** Every amount, quantity, percentage and date column is set in the figure face: Martian Mono, 80% width, tabular and slashed-zero numerals, -0.01em, no wrapping, right-aligned in the value column. Words are never set in the figure face.

**The Sentence Case Rule.** Buttons, tabs, segments, list headers and card subtitles are sentence case with no added tracking; Ionic's uppercase defaults are switched off.

## Layout

Single column, centred, max 640px wide (auth screens 420px), with 16px page gutters and a bottom pad of 48px plus the safe-area inset. Sections stack 32px apart; a section head sits 8px above its sheet, with the title left and an optional accent text link right on the baseline. Spacing runs on a 4px base: 4 / 8 / 12 / 16 / 24 / 32 / 48.

The statement row is a two-column grid: a flexible label column (label over sub-line) and an auto-width right-aligned value column, 12px apart, min 56px tall, 8px by 16px padding. Rows with a leading icon add a 24px column; add-option rows use a 36px glyph column, a 16px chevron column and 68px height. Labels wrap (overflow-wrap: anywhere) rather than truncate, so ru/fr strings survive.

Navigation: four bottom tabs (Übersicht, Bestände, Quellen, Markt), each an outline icon over a wrapping 0.75rem label, on a 56px sheet-coloured bar. Settings is not a tab: it is reached through the profile avatar at the right of the AppTopBar, next to the privacy (hide balances) toggle; the portfolio switcher sits at the left on top-level screens, a back button on nested ones. Toolbars are 52px with a single bottom hairline.

## Elevation & Depth

Flat. Content never casts a shadow: Ionic header shadows and button/card shadows are removed. Depth is two tones (ground, then sheet) plus 1px hairlines. Modals and sheets are the only layered surfaces, separated by Ionic's backdrop (#0b120f light, black in dark) rather than by drop shadows.

### Named Rules
**The Paper-On-Desk Rule.** A sheet is distinguished from the ground by tone and a hairline border, nothing else. If something needs to feel "above", it is a modal.

## Shapes

Softly squared paper. Sheets, inset lists, cards, notices and toasts share a 10px radius; buttons 6px; tags and skeleton bars 4px; modals 14px. Circles are reserved for the avatar, asset icons, add-option glyph discs and status-mark dots (7px). The allocation bar is a 14px strip with 3px corners and 2px gaps between segments; legend swatches are 10px squares with 2px corners. Borders are always 1px, except the Summenstrich (3px double).

## Components

### Sheet and Statement Row
The core surface. A sheet (statement-sheet ground, 1px hairline border, 10px radius) holds a list of statement rows divided by hairlines (no rule above the first). Tappable rows are real buttons or links: pressing tints the row with 5% ink; the tap highlight is suppressed. Focus mode (tapping a position on the overview) washes the chosen row in bank-stamp-blue-soft with aria-pressed, dims the others to 42% opacity, and filters the movements below to that source. Row transitions are 180ms on the house ease.

### Summenstrich Total
The signature. The closing row of a statement sits under a 3px double rule in ink, bold (700) label, figure at 1.125rem / 650. Used for the overview Saldo row, an asset's total quantity, and any list that sums.

### Day Heading
Inside a booking list, each day opens with a 0.75rem / 650 ink-secondary heading, tracked +0.02em, padded 12px 16px 4px, separated by a hairline. It is aria-hidden; each booking line carries the day in its own accessible label.

### Booking Line (MovementList)
An ordered statement of day-grouped movement lines: asset icon, symbol (and source), a sub-line "kind · origin · account type · n bookings", and on the right the signed quantity in figures (uncoloured) over either its value or the running "balance after" quantity. In asset detail the line is the destination and is not a link.

### Marks
Status as text first, shape second, colour third: a 0.75rem / 600 label preceded by a 7px dot in currentColor. Variants ok (gain), warn (ochre), error (loss), neutral (ink-secondary); busy pulses the dot (1.2s). Error marks can be buttons whose text is underlined and clamped to two lines.

### Tags
Account type, origin, plan: 0.75rem / 600 ink-secondary text, 1px control-rule border, 4px radius, 1px by 6px padding. Outline only, never filled.

### Notices
Inline, full-radius tinted panels with an icon and text, 12px by 16px padding, 0.875rem ink text. Warning is the default (ochre soft), error (loss soft, role alert, with an outline Retry button), info (blue soft). No coloured side borders.

### Buttons
- **Shape:** 6px radius, no shadow, min height 44px (also for size small), sentence case, 600 weight.
- **Primary:** bank-stamp blue with white text (dark: pale blue with night-ground text).
- **Outline / Clear:** blue text and border, used for Retry and secondary actions; icon-only toolbar buttons are 44px square.
- **Text links:** section links (0.875rem / 550) and inline links (600) in blue, both padded to a 44px hit area.

### Chips and Segments
Chips are blue-soft with blue text, 44px tall. Segments (chart ranges 24h / 7d / 30d / 1y) sit on a 6% ink track with a sheet-coloured indicator; checked text is ink, unchecked ink-secondary. A locked Pro range shows a lock icon plus an sr-only "(Pro)" and opens the paywall instead of switching.

### Inputs
Ionic inputs inside a sheet-ground list framed by a 1px control-rule border at 10px radius (auth screens); focus highlight and caret in bank-stamp blue.

### Value Chart
One thin line: 1.5px ink stroke (non-scaling) over a 5% ink area fill, 96px tall, first and last value as figure-face axis labels. Above it the change line: arrow icon, sr-only direction word, signed amount and signed percent in figures, then "since …" in ink-secondary. The chart has role img with a "from → to" label.

### Allocation Bar
A single segmented strip in the series inks with a wrapping legend (swatch, name, right-aligned percentage). It replaces the donut.

### Navigation
AppTopBar and the four-tab bar as described under Layout. Selected tab is bank-stamp blue, unselected ink-secondary; labels wrap to two lines rather than truncate. The avatar is a 30px ink disc with the user's initial in ground colour.

### Empty State
Left-aligned, 32px by 16px padding: a 1.375rem / 650 heading, a 40ch ink-secondary sentence that teaches the next step, then the action (the add options sheet on the overview).

### Fresh-Line Highlight (motion)
The one authored motion moment: a newly booked line fades from highlighter yellow to transparent over 1600ms on cubic-bezier(0.16, 1, 0.3, 1) after a 200ms delay. Page transitions use Ionic's short Material transition (on iOS-mode controls) because the long iOS push desyncs fast tab taps. Under prefers-reduced-motion, page animation is off at bootstrap, all CSS animation and transition durations collapse to 0.01ms, and the fresh line keeps a static highlighter background instead.

### Accessibility as implemented
One keyboard-only focus ring everywhere (2px bank-stamp blue, 2px offset; inset on Ionic parts). Touch targets at least 44px on buttons, tabs, segments, chips and links. Control borders at 3:1. Text size adjust left to the user; layout uses rem and wrapping. Figures and charts carry sr-only words and aria-labels; movement lists are labelled ordered lists with per-line descriptions; the movements sheet is aria-live polite. Privacy mode masks every amount.

## Do's and Don'ts

### Do:
- **Do** build every list of money or quantities as a statement: sheet, hairline rows, right-aligned figures, and a Summenstrich total when the rows sum.
- **Do** set every figure in Martian Mono at 80% width with tabular, slashed-zero numerals; set every word in Golos Text.
- **Do** sign every gain/loss (+ / −) and add an arrow and sr-only word on headline changes; render sub-0.05% moves as flat ink-secondary.
- **Do** keep quantity deltas uncoloured; colour only value changes.
- **Do** reserve bank-stamp blue for action, selection and focus; use the print-ink series for data.
- **Do** keep every interactive target at 44px or more and let labels wrap in all six locales.
- **Do** separate surfaces with tone and 1px hairlines; use modals for anything layered.
- **Do** put "add" actions in the empty state and the Quellen header, never as floating chrome on the overview.

### Don't:
- **Don't** build navy card stacks (total card, donut card, chart card) or cards inside cards.
- **Don't** add trading-terminal energy: neon, glowing charts, tickers, or red/green alarm panels.
- **Don't** use colour as the only gain/loss signal, or green/red in allocation series.
- **Don't** put shadows on content surfaces, headers, buttons or cards.
- **Don't** add coloured side-border stripes to notices or rows.
- **Don't** use uppercase, tracked-out labels or small caps above titles; labels are sentence case.
- **Don't** add motion beyond the fresh-line highlight, the busy-mark pulse and the short page transition.
