import { env } from '../../config/env'
import { fromBaseUnits } from '../../lib/decimal'
import {
  ProviderError,
  type RawBalance,
  type RawStakingReward,
  type WalletProvider,
} from '../provider.types'

// Ethereum-Bestand über öffentliches JSON-RPC (ETH_RPC_URL konfigurierbar):
// eth_getBalance (ETH) + kuratierte ERC-20-Liste via eth_call balanceOf.
// Kein Indexer/API-Key — unbekannte Tokens sind damit prinzipbedingt unsichtbar
// (includeUnknownTokens hat hier keine Wirkung).

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

// balanceOf(address) — Funktions-Selector
const BALANCE_OF_SELECTOR = '0x70a08231'

// Kuratierte Mainnet-Tokens: Symbol → Contract + Decimals
const KNOWN_TOKENS: Array<{ symbol: string; contract: string; decimals: number }> = [
  { symbol: 'USDC', contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  { symbol: 'USDT', contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  { symbol: 'DAI', contract: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
  { symbol: 'WETH', contract: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
  { symbol: 'WBTC', contract: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
  // Liquid Staking: stETH rebased (Bestand wächst), wstETH/rETH steigen im Kurs
  { symbol: 'STETH', contract: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', decimals: 18 },
  { symbol: 'WSTETH', contract: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', decimals: 18 },
  { symbol: 'RETH', contract: '0xae78736Cd615f374D3085123A210448E74Fc6393', decimals: 18 },
  { symbol: 'LINK', contract: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18 },
  { symbol: 'UNI', contract: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', decimals: 18 },
]

// Withdrawals ab dieser Höhe gelten als Principal-Rückzahlung (Exit), nicht als
// Reward — Partial Withdrawals (Rewards) liegen weit unter 8 ETH, ein Exit
// bringt ≥ den Einsatz. Rückzahlung ist kein steuerlicher Zufluss.
const PRINCIPAL_THRESHOLD_GWEI = 8_000_000_000n // 8 ETH

// Beacon-Chain-Genesis (1.12.2020) — Withdrawal-Epoche → Zeitstempel, ohne Extra-Call
const BEACON_GENESIS_UNIX = 1606824023
const SECONDS_PER_EPOCH = 32 * 12

const BEACONCHAIN_BASE = 'https://beaconcha.in/api/v1'
// Free-Tier-Rate-Limit schonen: Withdrawals pro Sync deckeln (inkrementell via externalRef)
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

    // balanceOf(address) je kuratiertem Token — sequenziell, schont öffentliche RPCs
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
    return balances
  },

  // Validator-Rewards über beaconcha.in: Withdrawal-Adresse → Validatoren →
  // Withdrawals. Partial Withdrawals = ausgezahlte Rewards (post-Shapella);
  // Beträge ≥ 8 ETH werden als Principal-Rückzahlung übersprungen.
  // Execution-Layer-Rewards (MEV/Tips) sind hier nicht enthalten (dokumentierte Lücke).
  async fetchStakingRewards(
    address: string,
    sinceHint: { lastExternalRef: string | null },
  ): Promise<RawStakingReward[]> {
    // beaconcha.in verlangt auch für v1-Endpunkte einen (kostenlosen) API-Key —
    // ohne Key keine Validator-Rewards, der Bestands-Sync bleibt unberührt
    if (!env.BEACONCHAIN_API_KEY) return []

    let validators: Array<{ validatorindex: number }>
    try {
      validators = await beaconchain<Array<{ validatorindex: number }>>(
        `/validator/withdrawalCredentials/${address}`,
      )
    } catch (e) {
      // 400/404 = keine Validator-Zuordnung für diese Adresse — normales Wallet
      if (e instanceof ProviderError && e.code === 'PROVIDER_ERROR') return []
      throw e
    }
    const indices = (validators ?? []).map((v) => v.validatorindex).filter((v) => Number.isInteger(v))
    if (indices.length === 0) return []

    const withdrawals = await beaconchain<
      Array<{ epoch: number; amount: number; withdrawalindex: number; address: string }>
    >(`/validator/${indices.join(',')}/withdrawals`)

    const lastIndex = withdrawalIndexFromExternalRef(sinceHint.lastExternalRef)
    return (withdrawals ?? [])
      .filter((w) => lastIndex === null || w.withdrawalindex > lastIndex)
      .filter((w) => BigInt(w.amount) < PRINCIPAL_THRESHOLD_GWEI)
      .sort((a, b) => a.withdrawalindex - b.withdrawalindex)
      .slice(0, MAX_WITHDRAWALS_PER_SYNC)
      .map((w) => ({
        symbol: 'ETH',
        amount: fromBaseUnits(BigInt(w.amount), 9), // Gwei → ETH
        timestamp: new Date((BEACON_GENESIS_UNIX + w.epoch * SECONDS_PER_EPOCH) * 1000),
        externalRef: `eth-wd:${w.withdrawalindex}`,
      }))
  },
}
