import type { ProviderId } from '@prisma/client'
import { fromBaseUnits } from '../../lib/decimal'
import { ProviderError, type RawBalance, type WalletProvider } from '../provider.types'

// Generic EVM chain provider: eth_getBalance + a curated ERC-20 list via
// eth_call balanceOf. Ethereum itself stays in ethereum.ts (its own RPC from
// env, validator rewards) — here only the additional chains with fixed
// publicnode endpoints.

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const BALANCE_OF_SELECTOR = '0x70a08231'

export interface EvmToken {
  symbol: string
  contract: string
  decimals: number
}

export interface EvmChainConfig {
  id: ProviderId
  rpcUrl: string
  nativeSymbol: string
  tokens: EvmToken[]
}

interface RpcResponse<T> {
  result?: T
  error?: { code: number; message: string }
}

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (res.status === 429) {
    throw new ProviderError('RATE_LIMITED', 'EVM-RPC Rate-Limit erreicht, bitte später erneut')
  }
  if (!res.ok) {
    throw new ProviderError('PROVIDER_ERROR', `EVM-RPC antwortet mit ${res.status}`)
  }
  const json = (await res.json()) as RpcResponse<T>
  if (json.error) {
    throw new ProviderError('PROVIDER_ERROR', `EVM-RPC: ${json.error.message}`)
  }
  return json.result as T
}

function hexToBigInt(hex: string | null | undefined): bigint {
  if (!hex || hex === '0x') return 0n
  return BigInt(hex)
}

export function makeEvmProvider(config: EvmChainConfig): WalletProvider {
  return {
    kind: 'wallet',
    id: config.id,

    validateAddress(address: string): boolean {
      return ADDRESS_RE.test(address)
    },

    async fetchBalances(address: string): Promise<RawBalance[]> {
      const weiHex = await rpc<string>(config.rpcUrl, 'eth_getBalance', [address, 'latest'])
      const balances: RawBalance[] = []
      const wei = hexToBigInt(weiHex)
      if (wei > 0n) balances.push({ symbol: config.nativeSymbol, amount: fromBaseUnits(wei, 18) })

      const paddedAddress = address.slice(2).toLowerCase().padStart(64, '0')
      for (const token of config.tokens) {
        const result = await rpc<string>(config.rpcUrl, 'eth_call', [
          { to: token.contract, data: `${BALANCE_OF_SELECTOR}${paddedAddress}` },
          'latest',
        ])
        const raw = hexToBigInt(result)
        if (raw === 0n) continue
        balances.push({
          symbol: token.symbol,
          amount: fromBaseUnits(raw, token.decimals),
          meta: { contract: token.contract },
        })
      }
      return balances
    },
  }
}

export const polygonProvider = makeEvmProvider({
  id: 'POLYGON',
  rpcUrl: 'https://polygon-bor-rpc.publicnode.com',
  nativeSymbol: 'POL',
  tokens: [
    { symbol: 'USDC', contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
    { symbol: 'USDT', contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    { symbol: 'WETH', contract: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18 },
  ],
})

export const arbitrumProvider = makeEvmProvider({
  id: 'ARBITRUM',
  rpcUrl: 'https://arbitrum-one-rpc.publicnode.com',
  nativeSymbol: 'ETH',
  tokens: [
    { symbol: 'ARB', contract: '0x912CE59144191C1204E64559FE8253a0e49E6548', decimals: 18 },
    { symbol: 'USDC', contract: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    { symbol: 'USDT', contract: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
  ],
})

export const baseProvider = makeEvmProvider({
  id: 'BASE',
  rpcUrl: 'https://base-rpc.publicnode.com',
  nativeSymbol: 'ETH',
  tokens: [{ symbol: 'USDC', contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 }],
})

export const bscProvider = makeEvmProvider({
  id: 'BSC',
  rpcUrl: 'https://bsc-rpc.publicnode.com',
  nativeSymbol: 'BNB',
  tokens: [
    { symbol: 'USDT', contract: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    { symbol: 'USDC', contract: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    { symbol: 'ETH', contract: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', decimals: 18 },
  ],
})
