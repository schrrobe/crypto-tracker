import { fromBaseUnits } from '../../lib/decimal'
import { RETRYABLE_STATUS, bigIntFromJson, solanaRpc, solanaRpcText } from '../http'
import {
  ProviderError,
  type RawBalance,
  type RawStakingReward,
  type WalletProvider,
} from '../provider.types'

// Solana balance via public JSON-RPC (endpoint configurable via SOLANA_RPC_URL):
// getBalance (SOL) + getTokenAccountsByOwner (classic SPL tokens, jsonParsed).
// Token-2022 accounts are deliberately deferred.

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const STAKE_PROGRAM_ID = 'Stake11111111111111111111111111111111111111'
// Stake account layout: the withdrawer authority sits at byte offset 44, size 200 bytes
const STAKE_ACCOUNT_SIZE = 200
const STAKE_WITHDRAWER_OFFSET = 44

// First import: at most this many epochs backwards (~2 days/epoch ≈ 2 months).
// Public RPCs often don't retain older epochs anyway; older history
// comes via CSV import. Subsequent syncs run incrementally from lastExternalRef.
const REWARD_BACKFILL_EPOCHS = 30

// Curated mint→symbol mapping; unknown mints are created as an unmapped asset
// (no price, UI hint). Full contract mapping via CoinGecko arrives with M8.
const KNOWN_MINTS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 'BONK',
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: 'JUP',
  // Liquid-staking tokens — otherwise they fall victim to the dust filter
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: 'MSOL',
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: 'JITOSOL',
}

// Base58, 32 bytes → 32-44 characters
const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

// Read-after-the-fact consistency for a portfolio: every RPC call pins commitment
// 'finalized' so balances/rewards are deterministic across vendors (the default
// commitment is vendor-dependent). getBlockTime takes no config object and so is
// called without commitment.
const COMMITMENT = 'finalized' as const

// Cap on concurrent getBlockTime calls in the reward backfill (S2). Bounded so we
// don't trade the old serial round-trips for a rate-limit burst.
const BLOCKTIME_CONCURRENCY = 5

// Resolve fn over items with a bounded number of in-flight calls, preserving
// input order in the result array.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

interface TokenAccount {
  account: {
    data: {
      parsed: {
        info: {
          mint: string
          tokenAmount: { amount: string; decimals: number }
        }
      }
    }
  }
}

// Natively staked SOL lives in dedicated stake accounts (stake program) — found
// via the withdrawer authority. account.lamports = delegated stake +
// rent reserve + accrued rewards.
async function fetchStakeAccounts(address: string): Promise<Array<{ pubkey: string; lamports: bigint }>> {
  const result = await solanaRpc<Array<{ pubkey: string; account: { lamports: number } }>>(
    'getProgramAccounts',
    [
      STAKE_PROGRAM_ID,
      {
        encoding: 'jsonParsed',
        filters: [
          { dataSize: STAKE_ACCOUNT_SIZE },
          { memcmp: { offset: STAKE_WITHDRAWER_OFFSET, bytes: address } },
        ],
      },
    ],
    { commitment: COMMITMENT },
  )
  // A single stake account's lamports stays well under 2^53, so BigInt(number) is
  // exact here (unlike a whale's total getBalance value).
  return result.map((r) => ({ pubkey: r.pubkey, lamports: BigInt(r.account.lamports) }))
}

// Extract the epoch from a reward externalRef (sol-reward:<account>:<epoch>)
function epochFromExternalRef(ref: string | null): number | null {
  const match = ref?.match(/^sol-reward:[^:]+:(\d+)$/)
  return match ? Number(match[1]) : null
}

// Distinguish "retry later" (rate limit / HTTP 5xx / network) from "this epoch is
// genuinely gone" (RPC json-rpc error for a pruned/too-old epoch). A transient
// error must NOT let the cursor advance past the epoch — otherwise that epoch's
// reward is lost forever (it would never be re-queried). Pruned epochs, by
// contrast, must be skipped forward or one un-retainable epoch would stall every
// future reward. The retryable HTTP set is shared with the http helper (RETRYABLE_STATUS).

// A genuinely un-retainable epoch (RPC long-term-storage pruning / too-old slot).
// These never reappear, so the cursor must skip forward; older history is imported
// via CSV. Matched by message because JSON-RPC error codes vary across RPC vendors.
function isPrunedEpochError(e: ProviderError): boolean {
  return /prun|not found|older|cleaned up|skipped|missing|not available/i.test(e.message)
}

function isTransientRpcError(e: unknown): boolean {
  if (e instanceof ProviderError) {
    if (e.code === 'RATE_LIMITED') return true
    // A TIMEOUT (aborted request) is transient — retry on the next sync.
    if (e.code === 'TIMEOUT') return true
    // HTTP-level failure (solanaRpc attaches the status): only explicitly retryable
    // statuses are transient; a 4xx is terminal and must not stall the loop forever.
    if (e.status !== undefined) return RETRYABLE_STATUS.has(e.status)
    // JSON-RPC application error (no HTTP status): skip only known pruned/too-old
    // epochs; any other JSON-RPC error stops the loop (treated transient) so its
    // reward is never silently lost.
    return !isPrunedEpochError(e)
  }
  return true // unknown (e.g. fetch network throw) → treat as transient, never drop
}

export const solanaProvider: WalletProvider = {
  kind: 'wallet',
  id: 'SOLANA',

  validateAddress(address: string): boolean {
    return ADDRESS_RE.test(address)
  },

  async fetchBalances(address: string, options?: { includeUnknownTokens?: boolean }): Promise<RawBalance[]> {
    // Defense-in-depth: never POST a malformed address to the RPC (a stored row
    // could predate a validation change). Validated on source creation too.
    if (!ADDRESS_RE.test(address)) {
      throw new ProviderError('INVALID_ADDRESS', 'Ungültige Solana-Adresse')
    }

    // getBalance.value is lamports and can exceed 2^53 for a whale/exchange
    // account (> ~9M SOL), where JSON.parse would round it. Read it losslessly
    // from the raw response text as a BigInt. The application-error case (200 body
    // with an `error`) is handled the same way solanaRpc would.
    const balanceText = await solanaRpcText('getBalance', [address], { commitment: COMMITMENT })
    const balanceEnvelope = JSON.parse(balanceText) as { error?: { message: string } }
    if (balanceEnvelope.error) {
      throw new ProviderError('PROVIDER_ERROR', `Solana-RPC: ${balanceEnvelope.error.message}`)
    }
    const liquidLamports = bigIntFromJson(balanceText, 'value')

    const stakeAccounts = await fetchStakeAccounts(address)
    // account.lamports = delegated stake + accrued rewards + rent-exempt reserve.
    // The reserve is intentionally included: it is recoverable (refunded when the
    // stake account is deactivated and closed), so it is part of net worth — this
    // is a portfolio value, not a spendable-balance, view.
    const stakedLamports = stakeAccounts.reduce((sum, acc) => sum + acc.lamports, 0n)

    const balances: RawBalance[] = [
      { symbol: 'SOL', amount: fromBaseUnits(liquidLamports + stakedLamports, 9) },
    ]

    const tokenResult = await solanaRpc<{ value: TokenAccount[] }>(
      'getTokenAccountsByOwner',
      [address, { programId: TOKEN_PROGRAM_ID }, { encoding: 'jsonParsed' }],
      { commitment: COMMITMENT },
    )

    // Multiple token accounts can hold the same mint → sum in base units
    const byMint = new Map<string, { raw: bigint; decimals: number }>()
    for (const account of tokenResult.value) {
      const info = account.account.data.parsed.info
      const entry = byMint.get(info.mint)
      const raw = BigInt(info.tokenAmount.amount)
      if (entry) entry.raw += raw
      else byMint.set(info.mint, { raw, decimals: info.tokenAmount.decimals })
    }

    for (const [mint, { raw, decimals }] of byMint) {
      if (raw === 0n) continue
      const known = KNOWN_MINTS[mint]
      // Dust/spam filter: import unknown mints only on explicit request
      if (!known && !options?.includeUnknownTokens) continue
      // Unknown mints resolve to an unmapped asset BY this display symbol (the
      // global Asset table has no mint column). 4+4 base58 chars collided too
      // easily for crafted spam — 6+6 (~58^12) makes that effectively impossible.
      // The real mint stays in meta.mint for later mint-keyed mapping.
      const symbol = known ?? `${mint.slice(0, 6)}…${mint.slice(-6)}`
      balances.push({ symbol, amount: fromBaseUnits(raw, decimals), meta: { mint } })
    }

    return balances
  },

  // Inflation rewards of the stake accounts, one query per epoch. Incremental:
  // from the epoch after lastExternalRef; first import limited to REWARD_BACKFILL_EPOCHS.
  // Genuinely un-retained epochs (RPC pruning) are skipped forward; transient
  // failures (rate limit / 5xx) stop the loop so the cursor never jumps a gap —
  // the caller retries from the same epoch on the next sync (see isTransientRpcError).
  async fetchStakingRewards(
    address: string,
    sinceHint: { lastExternalRef: string | null },
  ): Promise<RawStakingReward[]> {
    const stakeAccounts = await fetchStakeAccounts(address)
    if (stakeAccounts.length === 0) return []
    const pubkeys = stakeAccounts.map((s) => s.pubkey)

    const epochInfo = await solanaRpc<{ epoch: number }>('getEpochInfo', [], { commitment: COMMITMENT })
    // Rewards for epoch E are credited at the start of E+1 → last completed = E−1
    const lastComplete = epochInfo.epoch - 1
    const lastKnown = epochFromExternalRef(sinceHint.lastExternalRef)
    const fromEpoch = Math.max(
      lastKnown !== null ? lastKnown + 1 : lastComplete - REWARD_BACKFILL_EPOCHS + 1,
      0,
    )

    // Set when a pass stops early (truncated import). We throw afterwards carrying the
    // rewards collected so far so the sync persists them AND flags PARTIAL_SYNC — a
    // clean run returns normally and is reported as a full success.
    let stop: { code: ProviderError['code']; status?: number; message: string } | null = null

    // Phase 1 — inflation rewards, one query per epoch, STRICTLY SEQUENTIAL. This is the
    // cursor-critical pass: stop at the first transient failure so the cursor never
    // advances past a gap (pruned/too-old epochs are skipped forward). Block times are
    // resolved afterwards in a batch (S2); they are not cursor-critical here because a
    // missing block time truncates back to the contiguous prefix in phase 2.
    interface PendingEpoch {
      epoch: number
      effectiveSlot: number
      entries: Array<{ pubkey: string; amountLamports: bigint }>
    }
    const pending: PendingEpoch[] = []
    for (let epoch = fromEpoch; epoch <= lastComplete; epoch += 1) {
      try {
        // retries:0 — the reward loop has its own stop/resume strategy; an HTTP retry
        // here would only burn the same epoch instead of letting the cursor logic run.
        const results = await solanaRpc<Array<{ amount: number; effectiveSlot: number } | null>>(
          'getInflationReward',
          [pubkeys, { epoch }],
          { commitment: COMMITMENT, retries: 0 },
        )
        // effectiveSlot is identical for all accounts in an epoch.
        const rewarded = results.filter((r): r is { amount: number; effectiveSlot: number } => !!r && r.amount > 0)
        if (rewarded.length === 0) continue
        const entries = results.flatMap((r, i) =>
          r && r.amount > 0 ? [{ pubkey: pubkeys[i]!, amountLamports: BigInt(r.amount) }] : [],
        )
        pending.push({ epoch, effectiveSlot: rewarded[0]!.effectiveSlot, entries })
      } catch (e) {
        // Transient (rate limit / 5xx / network): STOP — do not advance the cursor past
        // this epoch; it is retried on the next sync. Genuinely pruned/too-old epochs
        // are skipped forward (their history is imported via CSV).
        if (isTransientRpcError(e)) {
          stop = {
            code: e instanceof ProviderError ? e.code : 'PROVIDER_ERROR',
            status: e instanceof ProviderError ? e.status : undefined,
            message: e instanceof Error ? e.message : String(e),
          }
          break
        }
        continue
      }
    }

    // Phase 2 — resolve block times for the rewarded epochs with bounded concurrency
    // (S2: was one serial getBlockTime per epoch). A missing or failed block time
    // TRUNCATES to the contiguous prefix: keep every epoch below the first gap and stop
    // there, because a tax record needs a timestamp and the cursor must not jump a gap.
    // Phase-2 gaps sit at lower epochs than any phase-1 stop, so they take precedence.
    const rewards: RawStakingReward[] = []
    const blockTimes = await mapWithConcurrency(pending, BLOCKTIME_CONCURRENCY, async (p) => {
      try {
        // retries:0 for the same reason as getInflationReward above. getBlockTime takes
        // no config object → no commitment param.
        const blockTime = await solanaRpc<number | null>('getBlockTime', [p.effectiveSlot], { retries: 0 })
        return { blockTime, error: null as unknown }
      } catch (e) {
        return { blockTime: null as number | null, error: e as unknown }
      }
    })
    for (let i = 0; i < pending.length; i += 1) {
      const p = pending[i]!
      const bt = blockTimes[i]!
      if (bt.error) {
        // Cannot place this epoch in time → truncate here. A transient error keeps its
        // code/status so the next sync retries the epoch; a non-transient one still
        // stops rather than leave a silent gap.
        const err = bt.error
        stop = {
          code: err instanceof ProviderError ? err.code : 'PROVIDER_ERROR',
          status: err instanceof ProviderError ? err.status : undefined,
          message: err instanceof Error ? err.message : String(err),
        }
        break
      }
      if (bt.blockTime === null) {
        stop = { code: 'PROVIDER_ERROR', message: `Blockzeit fehlt für Epoche ${p.epoch}` }
        break
      }
      const timestamp = new Date(bt.blockTime * 1000)
      for (const entry of p.entries) {
        rewards.push({
          symbol: 'SOL',
          amount: fromBaseUnits(entry.amountLamports, 9),
          timestamp,
          externalRef: `sol-reward:${entry.pubkey}:${p.epoch}`,
        })
      }
    }
    // Truncated import → surface as a partial failure (carrying what we collected)
    // so the sync flags PARTIAL_SYNC instead of mistaking it for a complete success.
    if (stop) {
      throw new ProviderError(stop.code, `Solana-Rewards unvollständig: ${stop.message}`, stop.status, rewards)
    }
    return rewards
  },
}
