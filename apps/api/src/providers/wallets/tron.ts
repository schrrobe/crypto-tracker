import { fromBaseUnits } from '../../lib/decimal'
import { ProviderError, type RawBalance, type WalletProvider } from '../provider.types'

// Tron balance via the TronGrid accounts API (no API key required):
// data[0].balance in Sun (1e6) → TRX. Additionally USDT from the trc20 list —
// each element is a single-key object {contractAddress: amountString}.
// Further TRC-20 tokens are deliberately deferred (spam filter).

const TRONGRID_URL = 'https://api.trongrid.io/v1/accounts'

// Official Tether USDT contract on Tron, 6 decimals
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

// Base58Check, always T + 33 characters
const ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/

interface TronAccount {
  // missing when the account holds 0 TRX
  balance?: number
  frozenV2?: Array<{ amount?: number }>
  trc20?: Array<Record<string, string>>
}

interface AccountsResponse {
  success: boolean
  data: TronAccount[]
}

export const tronProvider: WalletProvider = {
  kind: 'wallet',
  id: 'TRON',

  validateAddress(address: string): boolean {
    return ADDRESS_RE.test(address)
  },

  async fetchBalances(address: string): Promise<RawBalance[]> {
    const res = await fetch(`${TRONGRID_URL}/${encodeURIComponent(address)}`)
    // TronGrid rejects invalid addresses (including a wrong checksum) with 400 — verified live
    if (res.status === 400) {
      throw new ProviderError('INVALID_ADDRESS', 'Tron-Adresse wurde von TronGrid abgelehnt')
    }
    if (res.status === 429) {
      throw new ProviderError('RATE_LIMITED', 'TronGrid Rate-Limit erreicht, bitte später erneut')
    }
    if (!res.ok) {
      throw new ProviderError('PROVIDER_ERROR', `TronGrid antwortet mit ${res.status}`)
    }

    const json = (await res.json()) as AccountsResponse
    if (!json.success) {
      throw new ProviderError('PROVIDER_ERROR', 'TronGrid meldet einen Fehler')
    }
    // Empty data: the account was never activated on-chain → no balance, no error
    const account = json.data[0]
    if (!account) return []
    const balances: RawBalance[] = []

    let sun = BigInt(account.balance ?? 0)
    for (const frozen of account.frozenV2 ?? []) {
      sun += BigInt(frozen.amount ?? 0)
    }
    if (sun > 0n) balances.push({ symbol: 'TRX', amount: fromBaseUnits(sun, 6) })

    // Filter USDT out of the TRC-20 balances (amounts as strings in 1e6)
    let usdtRaw = 0n
    for (const entry of account.trc20 ?? []) {
      const amount = entry[USDT_CONTRACT]
      if (amount !== undefined) usdtRaw += BigInt(amount)
    }
    if (usdtRaw > 0n) {
      balances.push({
        symbol: 'USDT',
        amount: fromBaseUnits(usdtRaw, 6),
        meta: { contract: USDT_CONTRACT },
      })
    }

    return balances
  },
}
