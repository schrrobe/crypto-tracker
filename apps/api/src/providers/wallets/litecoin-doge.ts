import type { ProviderId } from '@prisma/client'
import { fromBaseUnits } from '../../lib/decimal'
import { ProviderError, type RawBalance, type WalletProvider } from '../provider.types'

// Litecoin/Dogecoin balance via the Blockchair dashboards API (no API key required).
// Both chains return the same response shape — data[address].address.balance in
// base units (1e8) — hence a shared factory.
// ?limit=0 skips the transaction list; we only need the balance.

// Legacy (L…), P2SH (M…) as Base58Check; Bech32 (ltc1…)
const LTC_ADDRESS_RE = /^(ltc1[02-9ac-hj-np-z]{8,87}|[LM][1-9A-HJ-NP-Za-km-z]{25,34})$/
// Base58Check: D + version character (5-9, A-H, J-N, P-U) + 32 Base58 characters
const DOGE_ADDRESS_RE = /^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}$/

interface BlockchairDashboard {
  // balance is null for never-used addresses
  data: Record<string, { address: { balance: string | null } }> | null
  context: { code: number; error?: string }
}

interface ChainConfig {
  id: ProviderId
  chain: 'litecoin' | 'dogecoin'
  symbol: 'LTC' | 'DOGE'
  addressRe: RegExp
}

function makeBlockchairProvider(config: ChainConfig): WalletProvider {
  return {
    kind: 'wallet',
    id: config.id,

    validateAddress(address: string): boolean {
      return config.addressRe.test(address)
    },

    async fetchBalances(address: string): Promise<RawBalance[]> {
      const res = await fetch(
        `https://api.blockchair.com/${config.chain}/dashboards/address/${encodeURIComponent(address)}?limit=0`,
      )
      // Blockchair signals limits with its own HTTP codes: 402 (request limit),
      // 430 (IP temporarily blacklisted, verified live) and 435 (soft limit under load).
      if (res.status === 429 || res.status === 430 || res.status === 402 || res.status === 435) {
        throw new ProviderError(
          'RATE_LIMITED',
          'Blockchair Rate-Limit erreicht, bitte später erneut',
        )
      }
      if (res.status === 400 || res.status === 404) {
        throw new ProviderError(
          'INVALID_ADDRESS',
          `${config.symbol}-Adresse wurde von Blockchair abgelehnt`,
        )
      }
      if (!res.ok) {
        throw new ProviderError('PROVIDER_ERROR', `Blockchair antwortet mit ${res.status}`)
      }

      const json = JSON.parse(await res.text(), (key, value, context?: { source: string }) =>
        key === 'balance' && typeof value === 'number' ? context?.source : value,
      ) as BlockchairDashboard
      const entry = json.data?.[address]
      if (!entry) {
        throw new ProviderError(
          'PROVIDER_ERROR',
          `Blockchair liefert keine Daten für die ${config.symbol}-Adresse`,
        )
      }

      const units = BigInt(entry.address.balance ?? 0)
      if (units === 0n) return []
      return [{ symbol: config.symbol, amount: fromBaseUnits(units, 8) }]
    },
  }
}

export const litecoinProvider = makeBlockchairProvider({
  id: 'LITECOIN',
  chain: 'litecoin',
  symbol: 'LTC',
  addressRe: LTC_ADDRESS_RE,
})

export const dogecoinProvider = makeBlockchairProvider({
  id: 'DOGECOIN',
  chain: 'dogecoin',
  symbol: 'DOGE',
  addressRe: DOGE_ADDRESS_RE,
})
