import type { ProviderId } from '@prisma/client'
import { fromBaseUnits } from '../../lib/decimal'
import { ProviderError, type RawBalance, type WalletProvider } from '../provider.types'

// Litecoin-/Dogecoin-Bestand über die Blockchair-Dashboards-API (kein API-Key nötig).
// Beide Chains liefern dieselbe Antwortform — data[adresse].address.balance in
// Basis-Einheiten (1e8) — daher eine gemeinsame Factory.
// ?limit=0 spart die Transaktionsliste, wir brauchen nur die Balance.

// Legacy (L…), P2SH (M…) als Base58Check; Bech32 (ltc1…)
const LTC_ADDRESS_RE = /^(ltc1[02-9ac-hj-np-z]{8,87}|[LM][1-9A-HJ-NP-Za-km-z]{25,34})$/
// Base58Check: D + Versions-Zeichen (5-9, A-H, J-N, P-U) + 32 Base58-Zeichen
const DOGE_ADDRESS_RE = /^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}$/

interface BlockchairDashboard {
  // balance ist bei nie benutzten Adressen null
  data: Record<string, { address: { balance: number | null } }> | null
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
      // Blockchair meldet Limits mit eigenen HTTP-Codes: 402 (Request-Limit),
      // 430 (IP temporär geblacklistet, live verifiziert) und 435 (Soft-Limit bei Last).
      if (res.status === 429 || res.status === 430 || res.status === 402 || res.status === 435) {
        throw new ProviderError('RATE_LIMITED', 'Blockchair Rate-Limit erreicht, bitte später erneut')
      }
      if (res.status === 400 || res.status === 404) {
        throw new ProviderError('INVALID_ADDRESS', `${config.symbol}-Adresse wurde von Blockchair abgelehnt`)
      }
      if (!res.ok) {
        throw new ProviderError('PROVIDER_ERROR', `Blockchair antwortet mit ${res.status}`)
      }

      const json = (await res.json()) as BlockchairDashboard
      const entry = json.data?.[address]
      if (!entry) {
        throw new ProviderError('PROVIDER_ERROR', `Blockchair liefert keine Daten für die ${config.symbol}-Adresse`)
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
