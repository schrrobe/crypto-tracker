import { fromBaseUnits } from '../../lib/decimal'
import { ProviderError, type RawBalance, type WalletProvider } from '../provider.types'

// XRP-Bestand über das öffentliche Ripple-JSON-RPC (account_info, validierter Ledger).
// Balance kommt als String in Drops (1e6). Issued Currencies/Trustlines sind
// bewusst "Später" — nur natives XRP.

const RPC_URL = 'https://s1.ripple.com:51234/'

// Classic Address: Base58 (Ripple-Alphabet teilt die Zeichenmenge mit Bitcoin-Base58)
const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

interface AccountInfoResult {
  status?: string
  error?: string
  error_message?: string
  account_data?: { Balance: string }
}

export const xrpProvider: WalletProvider = {
  kind: 'wallet',
  id: 'XRP',

  validateAddress(address: string): boolean {
    return ADDRESS_RE.test(address)
  },

  async fetchBalances(address: string): Promise<RawBalance[]> {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'account_info',
        params: [{ account: address, ledger_index: 'validated' }],
      }),
    })
    if (res.status === 429) {
      throw new ProviderError('RATE_LIMITED', 'Ripple-RPC Rate-Limit erreicht, bitte später erneut')
    }
    if (!res.ok) {
      throw new ProviderError('PROVIDER_ERROR', `Ripple-RPC antwortet mit ${res.status}`)
    }

    const json = (await res.json()) as { result?: AccountInfoResult }
    const result = json.result

    // Konto existiert (noch) nicht on-ledger — die 10-XRP-Reserve wurde nie
    // eingezahlt. Kein Fehler: leeres Wallet, kein Bestand.
    if (result?.error === 'actNotFound') return []
    // Fehler kommen mit HTTP 200 + result.error (live verifiziert)
    if (result?.error === 'actMalformed') {
      throw new ProviderError('INVALID_ADDRESS', 'XRP-Adresse wurde vom Ripple-RPC abgelehnt')
    }
    if (result?.status !== 'success' || !result.account_data) {
      throw new ProviderError(
        'PROVIDER_ERROR',
        `Ripple-RPC: ${result?.error_message ?? result?.error ?? 'unerwartete Antwort'}`,
      )
    }

    const drops = BigInt(result.account_data.Balance)
    if (drops === 0n) return []
    return [{ symbol: 'XRP', amount: fromBaseUnits(drops, 6) }]
  },
}
