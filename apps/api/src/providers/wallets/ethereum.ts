import { env } from '../../config/env'
import { fromBaseUnits } from '../../lib/decimal'
import {
  ProviderError,
  type RawBalance,
  type RawStakingReward,
  type WalletProvider,
} from '../provider.types'

// Ethereum balance via public JSON-RPC (ETH_RPC_URL is configurable):
// eth_getBalance (ETH) + a curated ERC-20 list via eth_call balanceOf.
// No indexer/API key — unknown tokens are therefore inherently invisible
// (includeUnknownTokens has no effect here).

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

// balanceOf(address) — function selector
const BALANCE_OF_SELECTOR = '0x70a08231'

// Curated mainnet tokens: symbol → contract + decimals
const KNOWN_TOKENS: Array<{ symbol: string; contract: string; decimals: number }> = [
  { symbol: 'USDC', contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  { symbol: 'USDT', contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  { symbol: 'DAI', contract: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
  { symbol: 'WETH', contract: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
  { symbol: 'WBTC', contract: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
  // Liquid staking: stETH rebases (balance grows), wstETH/rETH appreciate in price
  { symbol: 'STETH', contract: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', decimals: 18 },
  { symbol: 'WSTETH', contract: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', decimals: 18 },
  { symbol: 'RETH', contract: '0xae78736Cd615f374D3085123A210448E74Fc6393', decimals: 18 },
  { symbol: 'LINK', contract: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18 },
  { symbol: 'UNI', contract: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', decimals: 18 },
]

// Withdrawals at or above this amount count as a principal repayment (exit), not as
// a reward — partial withdrawals (rewards) stay well below 8 ETH, while an exit
// returns ≥ the original stake. A repayment is not a taxable inflow.
const PRINCIPAL_THRESHOLD_GWEI = 8_000_000_000n // 8 ETH

// Beacon Chain genesis (2020-12-01) — withdrawal epoch → timestamp, without an extra call
const BEACON_GENESIS_UNIX = 1606824023
const SECONDS_PER_EPOCH = 32 * 12

const BEACONCHAIN_BASE = 'https://beaconcha.in/api/v1'
// Conserve the free-tier rate limit: cap withdrawals per sync (incremental via externalRef)
const MAX_WITHDRAWALS_PER_SYNC = 200

interface RpcResponse<T> {
  result?: T
  error?: { code: number; message: string }
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(env.ETH_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (res.status === 429) {
    throw new ProviderError('RATE_LIMITED', 'Ethereum-RPC Rate-Limit erreicht, bitte später erneut')
  }
  if (!res.ok) {
    throw new ProviderError('PROVIDER_ERROR', `Ethereum-RPC antwortet mit ${res.status}`)
  }
  const json = (await res.json()) as RpcResponse<T>
  if (json.error) {
    throw new ProviderError('PROVIDER_ERROR', `Ethereum-RPC: ${json.error.message}`)
  }
  return json.result as T
}

function hexToBigInt(hex: string | null | undefined): bigint {
  if (!hex || hex === '0x') return 0n
  return BigInt(hex)
}

async function beaconchain<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {}
  if (env.BEACONCHAIN_API_KEY) headers.apikey = env.BEACONCHAIN_API_KEY
  const res = await fetch(`${BEACONCHAIN_BASE}${path}`, { headers })
  if (res.status === 429) {
    throw new ProviderError('RATE_LIMITED', 'beaconcha.in Rate-Limit erreicht, bitte später erneut')
  }
  if (!res.ok) {
    throw new ProviderError('PROVIDER_ERROR', `beaconcha.in antwortet mit ${res.status}`)
  }
  const json = (await res.json()) as { status: string; data: T }
  if (json.status !== 'OK') {
    throw new ProviderError('PROVIDER_ERROR', `beaconcha.in: Status ${json.status}`)
  }
  return json.data
}

function withdrawalIndexFromExternalRef(ref: string | null): number | null {
  const match = ref?.match(/^eth-wd:(\d+)$/)
  return match ? Number(match[1]) : null
}

// beaconcha.in caps the number of validators per request — chunk index lists.
const MAX_VALIDATORS_PER_REQUEST = 100

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// Defensive Gwei parse: beaconcha.in returns integer Gwei as a JSON number, but a
// malformed (float/string/negative) value must not throw and kill the whole import.
function gweiToBigInt(amount: unknown): bigint | null {
  if (typeof amount === 'number' && Number.isInteger(amount) && amount >= 0) return BigInt(amount)
  if (typeof amount === 'string' && /^\d+$/.test(amount)) return BigInt(amount)
  return null
}

// Validator indices controlled by a withdrawal address (empty for an ordinary wallet).
async function fetchValidatorIndices(address: string): Promise<number[]> {
  let validators: Array<{ validatorindex: number }>
  try {
    validators = await beaconchain<Array<{ validatorindex: number }>>(
      `/validator/withdrawalCredentials/${address}`,
    )
  } catch (e) {
    // 400/404 = no validator association for this address — an ordinary wallet
    if (e instanceof ProviderError && e.code === 'PROVIDER_ERROR') return []
    throw e
  }
  return (validators ?? []).map((v) => v.validatorindex).filter((v) => Number.isInteger(v))
}

// Sum of the validators' current balances (Gwei) for a withdrawal address — the
// staked ETH principal that eth_getBalance never sees.
async function fetchValidatorBalanceGwei(address: string): Promise<bigint> {
  const indices = await fetchValidatorIndices(address)
  if (indices.length === 0) return 0n
  let total = 0n
  for (const group of chunk(indices, MAX_VALIDATORS_PER_REQUEST)) {
    const data = await beaconchain<
      Array<{ balance: number }> | { balance: number }
    >(`/validator/${group.join(',')}`)
    const rows = Array.isArray(data) ? data : [data]
    for (const v of rows) {
      const g = gweiToBigInt(v.balance)
      if (g !== null) total += g
    }
  }
  return total
}

export const ethereumProvider: WalletProvider = {
  kind: 'wallet',
  id: 'ETHEREUM',

  validateAddress(address: string): boolean {
    return ADDRESS_RE.test(address)
  },

  async fetchBalances(address: string): Promise<RawBalance[]> {
    const weiHex = await rpc<string>('eth_getBalance', [address, 'latest'])
    const balances: RawBalance[] = []
    const wei = hexToBigInt(weiHex)
    if (wei > 0n) balances.push({ symbol: 'ETH', amount: fromBaseUnits(wei, 18) })

    // balanceOf(address) per curated token — sequential, easy on public RPCs
    const paddedAddress = address.slice(2).toLowerCase().padStart(64, '0')
    for (const token of KNOWN_TOKENS) {
      const result = await rpc<string>('eth_call', [
        { to: token.contract, data: `${BALANCE_OF_SELECTOR}${paddedAddress}` },
        'latest',
      ])
      const raw = hexToBigInt(result)
      if (raw === 0n) continue
      balances.push({
        symbol: token.symbol,
        amount: fromBaseUnits(raw, token.decimals),
        meta: { contract: token.contract },
      })
    }

    // Staked ETH principal lives on the beacon chain, not in eth_getBalance — with a
    // beaconcha.in key, surface it as an EARN holding so the portfolio is not
    // undervalued (mirrors Solana counting natively-staked SOL into the SOL position).
    if (env.BEACONCHAIN_API_KEY) {
      try {
        const stakedGwei = await fetchValidatorBalanceGwei(address)
        if (stakedGwei > 0n) {
          balances.push({ symbol: 'ETH', amount: fromBaseUnits(stakedGwei, 9), accountType: 'EARN' })
        }
      } catch {
        // beaconcha.in unavailable → omit the staked-ETH holding this sync rather
        // than failing the core balance sync; it reappears on the next good sync.
      }
    }
    return balances
  },

  // Validator rewards via beaconcha.in: withdrawal address → validators →
  // withdrawals. Partial withdrawals = paid-out rewards (post-Shapella);
  // amounts ≥ 8 ETH are skipped as principal repayments.
  // Execution-layer rewards (MEV/tips) are not included here (documented gap).
  async fetchStakingRewards(
    address: string,
    sinceHint: { lastExternalRef: string | null },
  ): Promise<RawStakingReward[]> {
    // beaconcha.in requires a (free) API key even for v1 endpoints —
    // without a key there are no validator rewards; the balance sync is unaffected
    if (!env.BEACONCHAIN_API_KEY) return []

    const indices = await fetchValidatorIndices(address)
    if (indices.length === 0) return []

    const lastIndex = withdrawalIndexFromExternalRef(sinceHint.lastExternalRef)

    // beaconcha.in returns withdrawals newest-first in a bounded page. Page through
    // them (and chunk the validator list) so a long validator history is not silently
    // truncated — stop once a page is short or already entirely at/below the cursor.
    type Withdrawal = { epoch: number; amount: number; withdrawalindex: number; address: string }
    const PAGE = 100
    const collected: Withdrawal[] = []
    for (const group of chunk(indices, MAX_VALIDATORS_PER_REQUEST)) {
      for (let offset = 0; ; offset += PAGE) {
        const page =
          (await beaconchain<Withdrawal[]>(
            `/validator/${group.join(',')}/withdrawals?limit=${PAGE}&offset=${offset}`,
          )) ?? []
        collected.push(...page)
        if (page.length < PAGE) break
        if (lastIndex !== null && page.every((w) => w.withdrawalindex <= lastIndex)) break
      }
    }

    const fresh = collected
      .filter((w) => lastIndex === null || w.withdrawalindex > lastIndex)
      // ≥ 8 ETH = principal repayment (full exit), not a taxable reward. Edge case: a
      // slashed validator's final sub-8-ETH withdrawal would be misread as a reward —
      // rare; cross-checking validator exit status is deferred (documented gap).
      .filter((w) => {
        const g = gweiToBigInt(w.amount)
        return g !== null && g < PRINCIPAL_THRESHOLD_GWEI
      })
      .sort((a, b) => a.withdrawalindex - b.withdrawalindex)

    if (fresh.length > MAX_WITHDRAWALS_PER_SYNC) {
      // Surface the backlog rather than silently dropping it — the rest is imported
      // on the next sync (the cursor advances to the last imported withdrawalindex).
      console.warn(
        `[ethereum] ${address}: ${fresh.length} ausstehende Withdrawals, ` +
          `kappe auf ${MAX_WITHDRAWALS_PER_SYNC} — Rest folgt im nächsten Sync`,
      )
    }

    return fresh.slice(0, MAX_WITHDRAWALS_PER_SYNC).map((w) => ({
      symbol: 'ETH',
      amount: fromBaseUnits(gweiToBigInt(w.amount)!, 9), // Gwei → ETH (validated above)
      timestamp: new Date((BEACON_GENESIS_UNIX + w.epoch * SECONDS_PER_EPOCH) * 1000),
      externalRef: `eth-wd:${w.withdrawalindex}`,
    }))
  },
}
