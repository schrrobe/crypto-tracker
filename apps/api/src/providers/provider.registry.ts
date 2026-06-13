import type { ProviderId } from '@prisma/client'
import { env } from '../config/env'
import { AppError } from '../lib/errors'
import type { ExchangeProvider, Provider, WalletProvider } from './provider.types'
import { fakeExchangeProvider, fakeWalletProvider } from './fake.providers'
import { bitcoinProvider } from './wallets/bitcoin'
import { solanaProvider } from './wallets/solana'
import { ethereumProvider } from './wallets/ethereum'
import { krakenProvider } from './exchanges/kraken'
import { bitvavoProvider } from './exchanges/bitvavo'
import { coinbaseProvider } from './exchanges/coinbase'
import { bitpandaProvider } from './exchanges/bitpanda'
import { binanceProvider } from './exchanges/binance'
import { okxProvider } from './exchanges/okx'
import { bybitProvider } from './exchanges/bybit'
import { kucoinProvider } from './exchanges/kucoin'
import { bitstampProvider } from './exchanges/bitstamp'
import { gateioProvider } from './exchanges/gateio'
import { cryptocomProvider } from './exchanges/cryptocom'
import { arbitrumProvider, baseProvider, bscProvider, polygonProvider } from './wallets/evm'
import { dogecoinProvider, litecoinProvider } from './wallets/litecoin-doge'
import { cardanoProvider } from './wallets/cardano'
import { xrpProvider } from './wallets/xrp'
import { tronProvider } from './wallets/tron'
import { cosmosProvider } from './wallets/cosmos'

const EXCHANGE_IDS: ProviderId[] = [
  'COINBASE', 'KRAKEN', 'BITVAVO', 'BITPANDA',
  'BINANCE', 'OKX', 'BYBIT', 'KUCOIN', 'BITSTAMP', 'GATEIO', 'CRYPTOCOM',
]
const WALLET_IDS: ProviderId[] = [
  'BITCOIN', 'SOLANA', 'ETHEREUM',
  'POLYGON', 'ARBITRUM', 'BASE', 'BSC',
  'LITECOIN', 'DOGECOIN', 'CARDANO', 'XRP', 'TRON', 'COSMOS',
]

const realProviders = new Map<ProviderId, Provider>([
  ['BITCOIN', bitcoinProvider],
  ['SOLANA', solanaProvider],
  ['ETHEREUM', ethereumProvider],
  ['KRAKEN', krakenProvider],
  ['BITVAVO', bitvavoProvider],
  ['COINBASE', coinbaseProvider],
  ['BITPANDA', bitpandaProvider],
  ['BINANCE', binanceProvider],
  ['OKX', okxProvider],
  ['BYBIT', bybitProvider],
  ['KUCOIN', kucoinProvider],
  ['BITSTAMP', bitstampProvider],
  ['GATEIO', gateioProvider],
  ['CRYPTOCOM', cryptocomProvider],
  ['POLYGON', polygonProvider],
  ['ARBITRUM', arbitrumProvider],
  ['BASE', baseProvider],
  ['BSC', bscProvider],
  ['LITECOIN', litecoinProvider],
  ['DOGECOIN', dogecoinProvider],
  ['CARDANO', cardanoProvider],
  ['XRP', xrpProvider],
  ['TRON', tronProvider],
  ['COSMOS', cosmosProvider],
])

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
