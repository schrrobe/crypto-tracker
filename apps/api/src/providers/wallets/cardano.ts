import { fromBaseUnits } from '../../lib/decimal'
import { ProviderError, type RawBalance, type WalletProvider } from '../provider.types'

// Cardano-Bestand über die öffentliche Koios-API (kein API-Key nötig):
// POST /address_info liefert die aggregierte Balance in Lovelace (1e6) als String.
// Native Assets (asset_list der UTxOs) sind bewusst "Später" — nur ADA.

const KOIOS_URL = 'https://api.koios.rest/api/v1/address_info'

// Shelley-Adressen (Bech32): Enterprise ~58, Base ~103 Zeichen gesamt
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
    // Koios beantwortet ungültige Adressen mit 200 + leerem Array (live verifiziert);
    // 4xx kommt nur bei kaputtem Request — dennoch als Adressfehler einstufen.
    if (res.status >= 400 && res.status < 500) {
      throw new ProviderError('INVALID_ADDRESS', 'Cardano-Adresse wurde von Koios abgelehnt')
    }
    if (!res.ok) {
      throw new ProviderError('PROVIDER_ERROR', `Koios antwortet mit ${res.status}`)
    }

    const json = (await res.json()) as AddressInfo[]
    // Leeres Array: Adresse unbekannt/ungenutzt → kein Bestand, kein Fehler
    const info = json[0]
    if (!info) return []

    const lovelace = BigInt(info.balance)
    if (lovelace === 0n) return []
    return [{ symbol: 'ADA', amount: fromBaseUnits(lovelace, 6) }]
  },
}
