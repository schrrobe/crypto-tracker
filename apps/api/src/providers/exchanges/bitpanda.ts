import {
  ProviderError,
  type ExchangeCredentials,
  type ExchangeProvider,
  type RawBalance,
} from '../provider.types'

// Bitpanda Public API: GET /v1/wallets with X-Api-Key (no secret).
// Returns crypto wallets only; fiat lives under /v1/fiatwallets and is not tracked.

const BASE_URL = 'https://api.bitpanda.com/v1'

interface BitpandaWallet {
  type: string
  attributes: {
    cryptocoin_symbol: string
    balance: string
    deleted: boolean
  }
}

async function fetchBitpandaBalances(creds: ExchangeCredentials): Promise<RawBalance[]> {
  const res = await fetch(`${BASE_URL}/wallets`, {
    headers: { 'X-Api-Key': creds.apiKey },
  })
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('INVALID_API_KEY', 'Bitpanda: API-Key wurde abgelehnt')
  }
  if (res.status === 429) throw new ProviderError('RATE_LIMITED', 'Bitpanda Rate-Limit erreicht')
  if (!res.ok) throw new ProviderError('PROVIDER_ERROR', `Bitpanda antwortet mit ${res.status}`)

  const json = (await res.json()) as { data: BitpandaWallet[] }
  return json.data
    .filter((w) => !w.attributes.deleted && Number(w.attributes.balance) > 0)
    .map((w) => ({
      symbol: w.attributes.cryptocoin_symbol.toUpperCase(),
      amount: w.attributes.balance,
    }))
}

export const bitpandaProvider: ExchangeProvider = {
  kind: 'exchange',
  id: 'BITPANDA',

  async validateCredentials(creds: ExchangeCredentials): Promise<void> {
    await fetchBitpandaBalances(creds)
  },

  fetchBalances: fetchBitpandaBalances,
}
