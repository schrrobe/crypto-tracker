import { fromBaseUnits } from '../../lib/decimal'
import { ProviderError, type RawBalance, type WalletProvider } from '../provider.types'

// Tron-Bestand über die TronGrid-Accounts-API (kein API-Key nötig):
// data[0].balance in Sun (1e6) → TRX. Zusätzlich USDT aus der trc20-Liste —
// jedes Element ist ein Ein-Schlüssel-Objekt {contractAdresse: betragString}.
// Weitere TRC-20-Tokens sind bewusst "Später" (Spam-Filter).

const TRONGRID_URL = 'https://api.trongrid.io/v1/accounts'

// Offizieller Tether-USDT-Contract auf Tron, 6 Dezimalstellen
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

// Base58Check, immer T + 33 Zeichen
const ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/

interface TronAccount {
  // fehlt, wenn das Konto 0 TRX hält
  balance?: number
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
    // TronGrid lehnt ungültige Adressen (auch falsche Checksumme) mit 400 ab — live verifiziert
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
    // Leeres data: Konto wurde on-chain nie aktiviert → kein Bestand, kein Fehler
    const account = json.data[0]
    if (!account) return []
    const balances: RawBalance[] = []

    const sun = BigInt(account.balance ?? 0)
    if (sun > 0n) balances.push({ symbol: 'TRX', amount: fromBaseUnits(sun, 6) })

    // USDT aus den TRC-20-Beständen herausfiltern (Beträge als String in 1e6)
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
