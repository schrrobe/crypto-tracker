import { env } from '../../config/env'
import { fromBaseUnits } from '../../lib/decimal'
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

interface RpcResponse<T> {
  result?: T
  error?: { code: number; message: string }
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(env.SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (res.status === 429) {
    throw new ProviderError('RATE_LIMITED', 'Solana-RPC Rate-Limit erreicht, bitte später erneut')
  }
  if (!res.ok) {
    throw new ProviderError('PROVIDER_ERROR', `Solana-RPC antwortet mit ${res.status}`)
  }
  const json = (await res.json()) as RpcResponse<T>
  if (json.error) {
    throw new ProviderError('PROVIDER_ERROR', `Solana-RPC: ${json.error.message}`)
  }
  return json.result as T
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
  const result = await rpc<Array<{ pubkey: string; account: { lamports: number } }>>('getProgramAccounts', [
    STAKE_PROGRAM_ID,
    {
      encoding: 'jsonParsed',
      filters: [
        { dataSize: STAKE_ACCOUNT_SIZE },
        { memcmp: { offset: STAKE_WITHDRAWER_OFFSET, bytes: address } },
      ],
    },
  ])
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
// future reward.
function isTransientRpcError(e: unknown): boolean {
  if (e instanceof ProviderError) {
    if (e.code === 'RATE_LIMITED') return true
    // rpc() wraps HTTP-level failures as "… antwortet mit <status>" (429/5xx/etc.)
    if (e.code === 'PROVIDER_ERROR' && /antwortet mit \d/.test(e.message)) return true
    return false // json-rpc error (e.g. pruned epoch) → safely skippable
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
    const balanceResult = await rpc<{ value: number }>('getBalance', [address])

    const stakeAccounts = await fetchStakeAccounts(address)
    const stakedLamports = stakeAccounts.reduce((sum, acc) => sum + acc.lamports, 0n)

    const balances: RawBalance[] = [
      { symbol: 'SOL', amount: fromBaseUnits(BigInt(balanceResult.value) + stakedLamports, 9) },
    ]

    const tokenResult = await rpc<{ value: TokenAccount[] }>('getTokenAccountsByOwner', [
      address,
      { programId: TOKEN_PROGRAM_ID },
      { encoding: 'jsonParsed' },
    ])

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
      const symbol = known ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`
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

    const epochInfo = await rpc<{ epoch: number }>('getEpochInfo', [])
    // Rewards for epoch E are credited at the start of E+1 → last completed = E−1
    const lastComplete = epochInfo.epoch - 1
    const lastKnown = epochFromExternalRef(sinceHint.lastExternalRef)
    const fromEpoch = Math.max(
      lastKnown !== null ? lastKnown + 1 : lastComplete - REWARD_BACKFILL_EPOCHS + 1,
      0,
    )

    const rewards: RawStakingReward[] = []
    for (let epoch = fromEpoch; epoch <= lastComplete; epoch += 1) {
      try {
        const results = await rpc<Array<{ amount: number; effectiveSlot: number } | null>>(
          'getInflationReward',
          [pubkeys, { epoch }],
        )

        // effectiveSlot is the same for all accounts in an epoch → one getBlockTime suffices
        const first = results.find((r) => r !== null && r.amount > 0)
        if (!first) continue
        const blockTime = await rpc<number | null>('getBlockTime', [first.effectiveSlot])
        if (blockTime === null) continue // no retrievable timestamp (rare for recent epochs) → no tax record
        const timestamp = new Date(blockTime * 1000)

        results.forEach((r, i) => {
          if (!r || r.amount <= 0) return
          rewards.push({
            symbol: 'SOL',
            amount: fromBaseUnits(BigInt(r.amount), 9),
            timestamp,
            externalRef: `sol-reward:${pubkeys[i]}:${epoch}`,
          })
        })
      } catch (e) {
        // Transient (rate limit / 5xx / network): STOP — do not advance the cursor
        // past this epoch; it is retried on the next sync. Genuinely pruned/too-old
        // epochs are skipped forward (their history is imported via CSV).
        if (isTransientRpcError(e)) break
        continue
      }
    }
    return rewards
  },
}
