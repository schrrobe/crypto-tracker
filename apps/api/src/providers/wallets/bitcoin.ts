import { env } from '../../config/env'
import { fromBaseUnits } from '../../lib/decimal'
import { httpJson } from '../http'
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
    // Defense-in-depth: the address is validated on source creation, but never
    // hand a malformed value to the provider URL (a stored row could predate a
    // validation change).
    if (!ADDRESS_RE.test(address)) {
      throw new ProviderError('INVALID_ADDRESS', 'Ungültige Bitcoin-Adresse')
    }

    // httpJson gives us the abort-on-timeout + bounded retry (429/5xx) shared by
    // all migrated providers; mapStatus keeps mempool's 400 → INVALID_ADDRESS.
    const data = await httpJson<AddressResponse>(
      `${env.MEMPOOL_API_URL}/address/${encodeURIComponent(address)}`,
      {
        mapStatus: (status) => {
          if (status === 400) {
            return new ProviderError('INVALID_ADDRESS', 'Bitcoin-Adresse wurde von mempool.space abgelehnt', status)
          }
          if (status === 429) {
            return new ProviderError('RATE_LIMITED', 'mempool.space Rate-Limit erreicht, bitte später erneut', status)
          }
          return new ProviderError('PROVIDER_ERROR', `mempool.space antwortet mit ${status}`, status)
        },
      },
    )

    // funded/spent sums are satoshis. BTC total supply ≈ 2.1e15 sats is below
    // Number.MAX_SAFE_INTEGER (≈9.007e15), so JSON.parse keeps these exact for any
    // real address — no lossless-text read needed here (unlike Solana lamports).
    const sats =
      BigInt(data.chain_stats.funded_txo_sum) -
      BigInt(data.chain_stats.spent_txo_sum) +
      BigInt(data.mempool_stats.funded_txo_sum) -
      BigInt(data.mempool_stats.spent_txo_sum)

    return [{ symbol: 'BTC', amount: fromBaseUnits(sats, 8) }]
  },
}
