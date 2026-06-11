# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Personal crypto portfolio tracker (no trading, no withdrawals): balances from exchanges (read-only API keys), wallets (public addresses), CSV imports, and manual entry — valued in EUR/USD via CoinGecko. Full plan in `docs/PLAN.md`, current state in `docs/IMPLEMENTATION-STATE.md` (keep the latter updated when completing features).

**Language convention:** commit messages, code comments, docs, and server error texts are German. The frontend localizes via stable `error.code` values (6 locales: DE/EN/FR/PL/CS/RU in `apps/mobile/src/i18n/locales/`).

## Commands

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed   # one-time setup (Docker Postgres)
pnpm dev          # API :3010 + Ionic app :5173 concurrently
pnpm test         # all unit + integration tests (integration needs Docker Postgres running)
pnpm test:e2e     # Playwright, boots its own API/app on :3011/:5174 with DB crypto_tracker_e2e
pnpm typecheck    # tsc/vue-tsc across all workspaces
pnpm lint         # eslint from repo root
```

Single test file: `pnpm --filter @crypto-tracker/api exec vitest run src/providers/exchanges/kraken.test.ts` (same pattern with `@crypto-tracker/mobile`; use `--filter @crypto-tracker/e2e exec playwright test tests/auth.spec.ts` for one E2E spec). Prisma Studio: `pnpm db:studio`.

**Ports (non-standard):** Postgres on host port **5434** (5432/5433 are taken on this machine), API on **3010**. Integration tests use DB `crypto_tracker_test` (created automatically by `vitest.global-setup.ts` via `docker exec` into the `crypto-tracker-postgres` container — Postgres must be up). API vitest runs files serially (`fileParallelism: false`) because integration tests share that DB.

## Architecture

pnpm monorepo, four workspaces:

- **`apps/api`** — Express + Prisma + Zod, ESM (`type: module`). `src/modules/<feature>/` holds `*.routes.ts` + `*.service.ts`; routes only validate (Zod via `validate.middleware`) and delegate, services hold logic. Errors: throw `AppError` (`src/lib/errors.ts`) with a stable code; `error.middleware` shapes the response.
- **`apps/mobile`** — Ionic Vue + Pinia + vue-i18n. `services/api.client.ts` wraps fetch with 401 → refresh-token → retry; Pinia stores per domain mirror the API modules.
- **`packages/shared`** — Zod schemas, DTO types, enums consumed by both (exported as raw TS, no build step).
- **`e2e`** — Playwright; `global-setup.ts` starts isolated API/app instances (config in `e2e/config.ts`).

**Core abstraction — `PortfolioSource`:** every connection, import, or manual bucket is a source; every `Holding` belongs to exactly one source so provenance stays visible. Sync, imports, and portfolio aggregation all hang off this model.

**Provider layer:** `src/providers/provider.types.ts` defines `ExchangeProvider` / `WalletProvider` returning normalized `RawBalance[]` (symbols already mapped, e.g. Kraken XXBT→BTC; amounts as strings). `provider.registry.ts` swaps the 6 real providers (Kraken, Bitvavo, Coinbase, Bitpanda, Bitcoin, Solana) for deterministic fakes when `FAKE_PROVIDERS=true` (only honored with `APP_ENV=local`); `FAKE_PRICES` does the same for CoinGecko. All tests run with fakes — no network. Provider failures must throw `ProviderError` with a typed code; it lands as `errorCode` on the `SyncRun`.

`SyncService.syncSource()` is deliberately Express-free and queue-ready (planned BullMQ background sync); keep it that way.

**Money is never float:** amounts flow as string / `Prisma.Decimal` / BigInt end to end (helpers in `src/lib/decimal.ts`).

**Security invariants:**
- Exchange secrets are AES-256-GCM encrypted at rest (`src/lib/crypto.ts`); the API only ever returns a `…1234` preview.
- Ownership checks everywhere via `userId` from the JWT — return **404, not 403**, for foreign resources (covered by `src/integration/ownership.integration.test.ts`).
- `src/config/env.ts` validates env at import time and refuses to start dev/prod with default secrets or localhost CORS origins.

**Asset mapping is global** (assets are shared across users), so user-triggered CoinGecko mapping is only allowed for unmapped assets.

## Known gaps (deliberate, see IMPLEMENTATION-STATE.md)

- Exchange happy paths are verified via fixtures + live error paths only (no real read-only keys yet).
- Refresh token lives in localStorage — acceptable for local, must move to httpOnly cookies / Capacitor Secure Storage before any deployment.
- Milestone 9 (Capacitor native builds) is open; CSV transaction imports compute net balances but no PnL/cost basis.
