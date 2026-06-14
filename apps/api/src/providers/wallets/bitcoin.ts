import { env } from '../../config/env'
import { fromBaseUnits } from '../../lib/decimal'
import { ProviderError, type RawBalance, type WalletProvider } from '../provider.types'

// Bitcoin balance via the mempool.space API (no API key required).
// Balance = confirmed UTXOs + unconfirmed mempool movements.
// V1: individual addresses; xpub/HD wallets are deliberately deferred.

// Legacy (1…), P2SH (3…), Bech32/Bech32m (bc1…)
const ADDRESS_RE = /^(bc1[02-9ac-hj-np-z]{8,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/

interface TxoStats {
  funded_txo_sum: number
  spent_txo_sum: number
}

interface AddressResponse {
  chain_stats: TxoStats
  mempool_stats: TxoStats
}

export const bitcoinProvider: WalletProvider = {
  kind: 'wallet',
  id: 'BITCOIN',

  validateAddress(address: string): boolean {
    return ADDRESS_RE.test(address)
  },

  async fetchBalances(address: string): Promise<RawBalance[]> {
    const res = await fetch(`${env.MEMPOOL_API_URL}/address/${encodeURIComponent(address)}`)
    if (res.status === 400) {
      throw new ProviderError('INVALID_ADDRESS', 'Bitcoin-Adresse wurde von mempool.space abgelehnt')
    }
    if (res.status === 429) {
      throw new ProviderError('RATE_LIMITED', 'mempool.space Rate-Limit erreicht, bitte später erneut')
    }
    if (!res.ok) {
      throw new ProviderError('PROVIDER_ERROR', `mempool.space antwortet mit ${res.status}`)
    }

    const data = (await res.json()) as AddressResponse
    const sats =
      BigInt(data.chain_stats.funded_txo_sum) -
      BigInt(data.chain_stats.spent_txo_sum) +
      BigInt(data.mempool_stats.funded_txo_sum) -
      BigInt(data.mempool_stats.spent_txo_sum)

    return [{ symbol: 'BTC', amount: fromBaseUnits(sats, 8) }]
  },
}
