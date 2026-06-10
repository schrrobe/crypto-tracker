import type { ProviderId } from '@prisma/client'
import { env } from '../config/env'
import { AppError } from '../lib/errors'
import type { ExchangeProvider, Provider, WalletProvider } from './provider.types'
import { fakeExchangeProvider, fakeWalletProvider } from './fake.providers'

const EXCHANGE_IDS: ProviderId[] = ['COINBASE', 'KRAKEN', 'BITVAVO', 'BITPANDA']
const WALLET_IDS: ProviderId[] = ['BITCOIN', 'SOLANA']

// Echte Implementierungen werden in Meilenstein 4 (Wallets) und 5 (Exchanges)
// registriert: exchanges/kraken.ts, wallets/bitcoin.ts, ...
const realProviders = new Map<ProviderId, Provider>()

function buildRegistry(): Map<ProviderId, Provider> {
  if (env.FAKE_PROVIDERS) {
    return new Map<ProviderId, Provider>([
      ...EXCHANGE_IDS.map((id) => [id, fakeExchangeProvider(id)] as const),
      ...WALLET_IDS.map((id) => [id, fakeWalletProvider(id)] as const),
    ])
  }
  return realProviders
}

const registry = buildRegistry()

export function getProvider(id: ProviderId): Provider {
  const provider = registry.get(id)
  if (!provider) {
    throw AppError.badRequest('PROVIDER_NOT_IMPLEMENTED', `Provider ${id} ist noch nicht verfügbar`)
  }
  return provider
}

export function getExchangeProvider(id: ProviderId): ExchangeProvider {
  const provider = getProvider(id)
  if (provider.kind !== 'exchange') {
    throw AppError.badRequest('NOT_AN_EXCHANGE', `${id} ist kein Exchange-Provider`)
  }
  return provider
}

export function getWalletProvider(id: ProviderId): WalletProvider {
  const provider = getProvider(id)
  if (provider.kind !== 'wallet') {
    throw AppError.badRequest('NOT_A_WALLET', `${id} ist kein Wallet-Provider`)
  }
  return provider
}
