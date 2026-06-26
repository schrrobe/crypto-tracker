import { describe, expect, it } from 'vitest'
import { bitcoinProvider } from './bitcoin'
import { solanaProvider } from './solana'

// Opt-in live smoke tests — hit the REAL mempool.space / Solana mainnet-beta endpoints.
// Excluded from `pnpm test` (and CI) so the default suite stays deterministic and
// offline. Run on demand:
//
//   RUN_LIVE_PROVIDER_TESTS=1 pnpm --filter @crypto-tracker/api exec vitest run src/providers/wallets/live.test.ts
//
// Assertions are structural (shape + monotone lower bounds), never exact balances,
// since on-chain state drifts. This is the repeatable replacement for the manual
// "live verified" step in the original feature.
const LIVE = !!process.env.RUN_LIVE_PROVIDER_TESTS
const TIMEOUT = 30_000

// A decimal string like "57.20000000" or "0" — no scientific notation, no NaN.
function expectDecimalString(value: string) {
  expect(typeof value).toBe('string')
  expect(value).toMatch(/^\d+(\.\d+)?$/)
  expect(Number.isNaN(Number(value))).toBe(false)
}

describe.skipIf(!LIVE)('LIVE wallet providers', () => {
  it(
    'Bitcoin: genesis address returns a positive BTC balance',
    async () => {
      const balances = await bitcoinProvider.fetchBalances('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')
      expect(balances).toHaveLength(1)
      const btc = balances[0]!
      expect(btc.symbol).toBe('BTC')
      expectDecimalString(btc.amount)
      // The genesis coinbase (50 BTC) can never be spent; dust donations only add to it.
      expect(Number(btc.amount)).toBeGreaterThanOrEqual(50)
    },
    TIMEOUT,
  )

  it(
    'Solana: a known account returns a SOL position and well-formed amounts',
    async () => {
      // Solana Foundation delegated-stake authority — long-lived, non-zero account.
      const balances = await solanaProvider.fetchBalances('GdnSyH3YtwcxFvQrVVJMm1JhTS4QVX7MFsX56uJLUfiZ', {
        includeUnknownTokens: true,
      })
      const sol = balances.find((b) => b.symbol === 'SOL')
      expect(sol).toBeDefined()
      for (const b of balances) expectDecimalString(b.amount)
    },
    TIMEOUT,
  )
})
