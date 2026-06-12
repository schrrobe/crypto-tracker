import { env } from '../../config/env'
import { fromBaseUnits } from '../../lib/decimal'
import {
  ProviderError,
  type RawBalance,
  type RawStakingReward,
  type WalletProvider,
} from '../provider.types'

// Solana-Bestand über öffentliches JSON-RPC (Endpoint via SOLANA_RPC_URL konfigurierbar):
// getBalance (SOL) + getTokenAccountsByOwner (klassische SPL-Tokens, jsonParsed).
// Token-2022-Accounts sind bewusst "Später".

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const STAKE_PROGRAM_ID = 'Stake11111111111111111111111111111111111111'
// Stake-Account-Layout: Withdrawer-Authority liegt bei Byte-Offset 44, Größe 200 Bytes
const STAKE_ACCOUNT_SIZE = 200
const STAKE_WITHDRAWER_OFFSET = 44

// Erst-Import: maximal so viele Epochen rückwärts (~2 Tage/Epoche ≈ 2 Monate).
// Öffentliche RPCs halten ältere Epochen ohnehin oft nicht vor; ältere Historie
// kommt über CSV-Import. Folge-Syncs laufen inkrementell ab lastExternalRef.
const REWARD_BACKFILL_EPOCHS = 30

// Kuratiertes Mint→Symbol-Mapping; unbekannte Mints werden als unmapped Asset angelegt
// (kein Preis, UI-Hinweis). Vollständiges Contract-Mapping über CoinGecko kommt mit M8.
const KNOWN_MINTS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 'BONK',
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: 'JUP',
  // Liquid-Staking-Tokens — sonst fallen sie dem Dust-Filter zum Opfer
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: 'MSOL',
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: 'JITOSOL',
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

// Nativ gestakte SOL liegen in eigenen Stake-Accounts (Stake-Programm) — über
// die Withdrawer-Authority finden. account.lamports = delegierter Stake +
// Rent-Reserve + aufgelaufene Rewards.
async function fetchStakeAccounts(address: string): Promise<Array<{ pubkey: string; lamports: bigint }>> {
  const result = await rpc<Array<{ pubkey: string; account: { lamports: number } }>>('getProgramAccounts', [
    STAKE_PROGRAM_ID,
    {
      encoding: 'jsonParsed',
      filters: [
        { dataSize: STAKE_ACCOUNT_SIZE },
        { memcmp: { offset: STAKE_WITHDRAWER_OFFSET, bytes: address } },
      ],
    },
  ])
  return result.map((r) => ({ pubkey: r.pubkey, lamports: BigInt(r.account.lamports) }))
}

// Epoche aus einer Reward-externalRef (sol-reward:<account>:<epoch>) ziehen
function epochFromExternalRef(ref: string | null): number | null {
  const match = ref?.match(/^sol-reward:[^:]+:(\d+)$/)
  return match ? Number(match[1]) : null
}

export const solanaProvider: WalletProvider = {
  kind: 'wallet',
  id: 'SOLANA',

  validateAddress(address: string): boolean {
    return ADDRESS_RE.test(address)
  },

  async fetchBalances(address: string, options?: { includeUnknownTokens?: boolean }): Promise<RawBalance[]> {
    const balanceResult = await rpc<{ value: number }>('getBalance', [address])

    const stakeAccounts = await fetchStakeAccounts(address)
    const stakedLamports = stakeAccounts.reduce((sum, acc) => sum + acc.lamports, 0n)

    const balances: RawBalance[] = [
      { symbol: 'SOL', amount: fromBaseUnits(BigInt(balanceResult.value) + stakedLamports, 9) },
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
      const known = KNOWN_MINTS[mint]
      // Dust-/Spam-Filter: unbekannte Mints nur auf ausdrücklichen Wunsch importieren
      if (!known && !options?.includeUnknownTokens) continue
      const symbol = known ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`
      balances.push({ symbol, amount: fromBaseUnits(raw, decimals), meta: { mint } })
    }

    return balances
  },

  // Inflation-Rewards der Stake-Accounts, eine Abfrage pro Epoche. Inkrementell:
  // ab der Epoche nach lastExternalRef; Erst-Import begrenzt auf REWARD_BACKFILL_EPOCHS.
  // Nicht vorgehaltene Epochen (RPC-Pruning) werden still übersprungen.
  async fetchStakingRewards(
    address: string,
    sinceHint: { lastExternalRef: string | null },
  ): Promise<RawStakingReward[]> {
    const stakeAccounts = await fetchStakeAccounts(address)
    if (stakeAccounts.length === 0) return []
    const pubkeys = stakeAccounts.map((s) => s.pubkey)

    const epochInfo = await rpc<{ epoch: number }>('getEpochInfo', [])
    // Rewards für Epoche E werden zu Beginn von E+1 gutgeschrieben → letzte fertige = E−1
    const lastComplete = epochInfo.epoch - 1
    const lastKnown = epochFromExternalRef(sinceHint.lastExternalRef)
    const fromEpoch = Math.max(
      lastKnown !== null ? lastKnown + 1 : lastComplete - REWARD_BACKFILL_EPOCHS + 1,
      0,
    )

    const rewards: RawStakingReward[] = []
    for (let epoch = fromEpoch; epoch <= lastComplete; epoch += 1) {
      let results: Array<{ amount: number; effectiveSlot: number } | null>
      try {
        results = await rpc('getInflationReward', [pubkeys, { epoch }])
      } catch {
        continue // Epoche nicht (mehr) verfügbar
      }

      // effectiveSlot ist für alle Accounts einer Epoche gleich → ein getBlockTime reicht
      const first = results.find((r) => r !== null && r.amount > 0)
      if (!first) continue
      const blockTime = await rpc<number | null>('getBlockTime', [first.effectiveSlot]).catch(() => null)
      if (blockTime === null) continue // ohne belastbaren Zeitstempel kein Steuer-Datensatz
      const timestamp = new Date(blockTime * 1000)

      results.forEach((r, i) => {
        if (!r || r.amount <= 0) return
        rewards.push({
          symbol: 'SOL',
          amount: fromBaseUnits(BigInt(r.amount), 9),
          timestamp,
          externalRef: `sol-reward:${pubkeys[i]}:${epoch}`,
        })
      })
    }
    return rewards
  },
}
