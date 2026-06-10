import { env } from '../../config/env'
import { fromBaseUnits } from '../../lib/decimal'
import { ProviderError, type RawBalance, type WalletProvider } from '../provider.types'

// Solana-Bestand über öffentliches JSON-RPC (Endpoint via SOLANA_RPC_URL konfigurierbar):
// getBalance (SOL) + getTokenAccountsByOwner (klassische SPL-Tokens, jsonParsed).
// Token-2022-Accounts sind bewusst "Später".

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

// Kuratiertes Mint→Symbol-Mapping; unbekannte Mints werden als unmapped Asset angelegt
// (kein Preis, UI-Hinweis). Vollständiges Contract-Mapping über CoinGecko kommt mit M8.
const KNOWN_MINTS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 'BONK',
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: 'JUP',
}

// Base58, 32 Bytes → 32-44 Zeichen
const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

interface RpcResponse<T> {
  result?: T
  error?: { code: number; message: string }
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(env.SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (res.status === 429) {
    throw new ProviderError('RATE_LIMITED', 'Solana-RPC Rate-Limit erreicht, bitte später erneut')
  }
  if (!res.ok) {
    throw new ProviderError('PROVIDER_ERROR', `Solana-RPC antwortet mit ${res.status}`)
  }
  const json = (await res.json()) as RpcResponse<T>
  if (json.error) {
    throw new ProviderError('PROVIDER_ERROR', `Solana-RPC: ${json.error.message}`)
  }
  return json.result as T
}

interface TokenAccount {
  account: {
    data: {
      parsed: {
        info: {
          mint: string
          tokenAmount: { amount: string; decimals: number }
        }
      }
    }
  }
}

export const solanaProvider: WalletProvider = {
  kind: 'wallet',
  id: 'SOLANA',

  validateAddress(address: string): boolean {
    return ADDRESS_RE.test(address)
  },

  async fetchBalances(address: string): Promise<RawBalance[]> {
    const balanceResult = await rpc<{ value: number }>('getBalance', [address])
    const balances: RawBalance[] = [
      { symbol: 'SOL', amount: fromBaseUnits(BigInt(balanceResult.value), 9) },
    ]

    const tokenResult = await rpc<{ value: TokenAccount[] }>('getTokenAccountsByOwner', [
      address,
      { programId: TOKEN_PROGRAM_ID },
      { encoding: 'jsonParsed' },
    ])

    // Mehrere Token-Accounts können denselben Mint halten → in Basis-Einheiten summieren
    const byMint = new Map<string, { raw: bigint; decimals: number }>()
    for (const account of tokenResult.value) {
      const info = account.account.data.parsed.info
      const entry = byMint.get(info.mint)
      const raw = BigInt(info.tokenAmount.amount)
      if (entry) entry.raw += raw
      else byMint.set(info.mint, { raw, decimals: info.tokenAmount.decimals })
    }

    for (const [mint, { raw, decimals }] of byMint) {
      if (raw === 0n) continue
      const symbol = KNOWN_MINTS[mint] ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`
      balances.push({ symbol, amount: fromBaseUnits(raw, decimals), meta: { mint } })
    }

    return balances
  },
}
