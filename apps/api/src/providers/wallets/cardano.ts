import { fromBaseUnits } from '../../lib/decimal'
import { ProviderError, type RawBalance, type WalletProvider } from '../provider.types'

// Cardano balance via the public Koios API (no API key required):
// POST /address_info returns the aggregated balance in Lovelace (1e6) as a string.
// Native assets (asset_list of the UTxOs) are deliberately deferred — ADA only.

const KOIOS_URL = 'https://api.koios.rest/api/v1/address_info'

// Shelley addresses (Bech32): Enterprise ~58, Base ~103 characters total
const ADDRESS_RE = /^addr1[a-z0-9]{50,110}$/

interface AddressInfo {
  address: string
  balance: string
}

export const cardanoProvider: WalletProvider = {
  kind: 'wallet',
  id: 'CARDANO',

  validateAddress(address: string): boolean {
    return ADDRESS_RE.test(address)
  },

  async fetchBalances(address: string): Promise<RawBalance[]> {
    const res = await fetch(KOIOS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _addresses: [address] }),
    })
    if (res.status === 429) {
      throw new ProviderError('RATE_LIMITED', 'Koios Rate-Limit erreicht, bitte später erneut')
    }
    // Koios answers invalid addresses with 200 + an empty array (verified live);
    // a 4xx only occurs for a malformed request — still classify it as an address error.
    if (res.status >= 400 && res.status < 500) {
      throw new ProviderError('INVALID_ADDRESS', 'Cardano-Adresse wurde von Koios abgelehnt')
    }
    if (!res.ok) {
      throw new ProviderError('PROVIDER_ERROR', `Koios antwortet mit ${res.status}`)
    }

    const json = (await res.json()) as AddressInfo[]
    // Empty array: address unknown/unused → no balance, no error
    const info = json[0]
    if (!info) return []

    const lovelace = BigInt(info.balance)
    if (lovelace === 0n) return []
    return [{ symbol: 'ADA', amount: fromBaseUnits(lovelace, 6) }]
  },
}
