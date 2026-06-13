import { fromBaseUnits } from '../../lib/decimal'
import { ProviderError, type RawBalance, type WalletProvider } from '../provider.types'

// Cosmos-Hub-Bestand über einen öffentlichen LCD-Endpunkt (cosmos.directory
// proxied auf gesunde Nodes): Bank-Balance (uatom, 1e6) plus Delegationen.
// Gestakte ATOM liegen nicht im Bank-Modul, sondern als Delegationen beim
// Staking-Modul — sie zählen zum Bestand, konsistent zum Solana-Provider
// (dort zählen Stake-Accounts ebenfalls mit). IBC-Tokens sind bewusst "Später".

const LCD_URL = 'https://rest.cosmos.directory/cosmoshub'

// Bech32: cosmos1 + 38 Zeichen (20-Byte-Konto)
const ADDRESS_RE = /^cosmos1[a-z0-9]{38}$/

interface CoinAmount {
  denom: string
  amount: string
}

async function lcdGet<T>(path: string): Promise<T> {
  const res = await fetch(`${LCD_URL}${path}`)
  if (res.status === 429) {
    throw new ProviderError('RATE_LIMITED', 'Cosmos-LCD Rate-Limit erreicht, bitte später erneut')
  }
  // LCD lehnt ungültige Bech32-Adressen mit 400 ab ("decoding bech32 failed") — live verifiziert
  if (res.status === 400) {
    throw new ProviderError('INVALID_ADDRESS', 'Cosmos-Adresse wurde vom LCD abgelehnt')
  }
  if (!res.ok) {
    throw new ProviderError('PROVIDER_ERROR', `Cosmos-LCD antwortet mit ${res.status}`)
  }
  return (await res.json()) as T
}

export const cosmosProvider: WalletProvider = {
  kind: 'wallet',
  id: 'COSMOS',

  validateAddress(address: string): boolean {
    return ADDRESS_RE.test(address)
  },

  async fetchBalances(address: string): Promise<RawBalance[]> {
    const encoded = encodeURIComponent(address)

    const bank = await lcdGet<{ balances: CoinAmount[] }>(`/cosmos/bank/v1beta1/balances/${encoded}`)
    let uatom = 0n
    for (const coin of bank.balances) {
      if (coin.denom === 'uatom') uatom += BigInt(coin.amount)
    }

    // Delegationen (gestakte ATOM) zur Position addieren
    const staking = await lcdGet<{ delegation_responses: Array<{ balance: CoinAmount }> }>(
      `/cosmos/staking/v1beta1/delegations/${encoded}`,
    )
    for (const delegation of staking.delegation_responses) {
      if (delegation.balance.denom === 'uatom') uatom += BigInt(delegation.balance.amount)
    }

    if (uatom === 0n) return []
    return [{ symbol: 'ATOM', amount: fromBaseUnits(uatom, 6) }]
  },
}
