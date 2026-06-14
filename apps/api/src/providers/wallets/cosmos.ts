import { fromBaseUnits } from '../../lib/decimal'
import { ProviderError, type RawBalance, type WalletProvider } from '../provider.types'

// Cosmos Hub balance via a public LCD endpoint (cosmos.directory
// proxies to healthy nodes): bank balance (uatom, 1e6) plus delegations.
// Staked ATOM does not live in the bank module but as delegations in the
// staking module — it counts toward the balance, consistent with the Solana provider
// (where stake accounts are counted too). IBC tokens are deliberately deferred.

const LCD_URL = 'https://rest.cosmos.directory/cosmoshub'

// Bech32: cosmos1 + 38 characters (20-byte account)
const ADDRESS_RE = /^cosmos1[a-z0-9]{38}$/

interface CoinAmount {
  denom: string
  amount: string
}

interface UnbondingDelegation {
  entries: Array<{ balance: string }>
}

async function lcdGet<T>(path: string): Promise<T> {
  const res = await fetch(`${LCD_URL}${path}`)
  if (res.status === 429) {
    throw new ProviderError('RATE_LIMITED', 'Cosmos-LCD Rate-Limit erreicht, bitte später erneut')
  }
  // LCD rejects invalid Bech32 addresses with 400 ("decoding bech32 failed") — verified live
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

    const bank = await lcdGet<{ balances: CoinAmount[] }>(
      `/cosmos/bank/v1beta1/balances/${encoded}`,
    )
    let uatom = 0n
    for (const coin of bank.balances) {
      if (coin.denom === 'uatom') uatom += BigInt(coin.amount)
    }

    // Add delegations (staked ATOM) to the position
    const staking = await lcdGet<{ delegation_responses: Array<{ balance: CoinAmount }> }>(
      `/cosmos/staking/v1beta1/delegations/${encoded}`,
    )
    for (const delegation of staking.delegation_responses) {
      if (delegation.balance.denom === 'uatom') uatom += BigInt(delegation.balance.amount)
    }

    // ATOM in the unbonding period still belongs to the balance
    const unbonding = await lcdGet<{ unbonding_responses: UnbondingDelegation[] }>(
      `/cosmos/staking/v1beta1/delegators/${encoded}/unbonding_delegations`,
    )
    for (const delegation of unbonding.unbonding_responses) {
      for (const entry of delegation.entries) {
        uatom += BigInt(entry.balance)
      }
    }
    if (uatom === 0n) return []
    return [{ symbol: 'ATOM', amount: fromBaseUnits(uatom, 6) }]
  },
}
