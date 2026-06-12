import { afterEach, describe, expect, it, vi } from 'vitest'
import { solanaProvider } from './solana'

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const UNKNOWN_MINT = 'So11111111111111111111111111111111111111112'

function tokenAccount(mint: string, amount: string, decimals: number) {
  return {
    account: {
      data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } },
    },
  }
}

// Antworten in Aufruf-Reihenfolge: getBalance, getProgramAccounts (Stake), getTokenAccountsByOwner
function mockRpc(responses: unknown[]) {
  const fn = vi.fn()
  for (const result of responses) {
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result }) })
  }
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('solanaProvider', () => {
  it('validiert Base58-Adressen', () => {
    expect(solanaProvider.validateAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')).toBe(true)
    expect(solanaProvider.validateAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(false) // l/0 nicht in Base58
    expect(solanaProvider.validateAddress('zu-kurz')).toBe(false)
  })

  it('liefert SOL- und SPL-Bestände mit Mint-Mapping', async () => {
    mockRpc([
      { value: 2_500_000_000 }, // 2.5 SOL
      [], // keine Stake-Accounts
      {
        value: [
          tokenAccount(USDC_MINT, '12500000', 6), // 12.5 USDC
          tokenAccount(UNKNOWN_MINT, '7000000000', 9), // 7 eines unbekannten Tokens
        ],
      },
    ])

    const balances = await solanaProvider.fetchBalances('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', {
      includeUnknownTokens: true,
    })

    expect(balances).toContainEqual({ symbol: 'SOL', amount: '2.5' })
    expect(balances).toContainEqual({ symbol: 'USDC', amount: '12.5', meta: { mint: USDC_MINT } })
    // Unbekannter Mint → Kurzform als Symbol, bleibt unmapped (kein Preis)
    expect(balances).toContainEqual({
      symbol: 'So11…1112',
      amount: '7',
      meta: { mint: UNKNOWN_MINT },
    })
  })

  it('Dust-Filter (Default): unbekannte Mints werden übersprungen', async () => {
    mockRpc([
      { value: 2_500_000_000 },
      [], // keine Stake-Accounts
      {
        value: [
          tokenAccount(USDC_MINT, '12500000', 6),
          tokenAccount(UNKNOWN_MINT, '7000000000', 9), // Spam — fliegt raus
        ],
      },
    ])

    const balances = await solanaProvider.fetchBalances('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')

    expect(balances).toContainEqual({ symbol: 'SOL', amount: '2.5' })
    expect(balances).toContainEqual({ symbol: 'USDC', amount: '12.5', meta: { mint: USDC_MINT } })
    expect(balances.find((b) => b.meta?.mint === UNKNOWN_MINT)).toBeUndefined()
  })

  it('summiert mehrere Token-Accounts mit demselben Mint', async () => {
    mockRpc([
      { value: 0 },
      [],
      {
        value: [tokenAccount(USDC_MINT, '1000000', 6), tokenAccount(USDC_MINT, '2500000', 6)],
      },
    ])
    const balances = await solanaProvider.fetchBalances('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')
    expect(balances).toContainEqual({ symbol: 'USDC', amount: '3.5', meta: { mint: USDC_MINT } })
  })

  it('lässt Token-Accounts mit Bestand 0 weg', async () => {
    mockRpc([{ value: 0 }, [], { value: [tokenAccount(USDC_MINT, '0', 6)] }])
    const balances = await solanaProvider.fetchBalances('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')
    expect(balances).toEqual([{ symbol: 'SOL', amount: '0' }])
  })

  it('zählt nativ gestakte SOL aus Stake-Accounts zur SOL-Position', async () => {
    mockRpc([
      { value: 1_000_000_000 }, // 1 SOL liquide
      [
        { account: { lamports: 5_000_000_000 } }, // 5 SOL gestakt
        { account: { lamports: 2_500_000_000 } }, // 2.5 SOL gestakt
      ],
      { value: [] },
    ])
    const balances = await solanaProvider.fetchBalances('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')
    // 1 + 5 + 2.5 = 8.5 SOL gesamt
    expect(balances).toEqual([{ symbol: 'SOL', amount: '8.5' }])
  })

  it('wirft PROVIDER_ERROR bei RPC-Fehler-Antwort', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ error: { code: -32602, message: 'Invalid param' } }),
      })),
    )
    await expect(
      solanaProvider.fetchBalances('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })
})

describe('solanaProvider.fetchStakingRewards', () => {
  const STAKE_ACC = 'StakeAcc111111111111111111111111111111111111'

  function stakeAccountsResponse() {
    return [{ pubkey: STAKE_ACC, account: { lamports: 5_000_000_000 } }]
  }

  it('liefert Rewards pro Epoche mit externalRef und Block-Zeitstempel', async () => {
    mockRpc([
      stakeAccountsResponse(), // getProgramAccounts
      { epoch: 702 }, // getEpochInfo → letzte fertige Epoche 701
      [{ amount: 50_000_000, effectiveSlot: 300000000 }], // getInflationReward Epoche 700
      1709251200, // getBlockTime
      [{ amount: 70_000_000, effectiveSlot: 300432000 }], // Epoche 701
      1709424000,
    ])

    const rewards = await solanaProvider.fetchStakingRewards!(
      '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
      // inkrementell: letzte bekannte Epoche 699 → Abfrage ab 700
      { lastExternalRef: `sol-reward:${STAKE_ACC}:699` },
    )

    expect(rewards).toEqual([
      {
        symbol: 'SOL',
        amount: '0.05',
        timestamp: new Date(1709251200 * 1000),
        externalRef: `sol-reward:${STAKE_ACC}:700`,
      },
      {
        symbol: 'SOL',
        amount: '0.07',
        timestamp: new Date(1709424000 * 1000),
        externalRef: `sol-reward:${STAKE_ACC}:701`,
      },
    ])
  })

  it('überspringt nicht verfügbare Epochen und Null-Einträge', async () => {
    const fn = vi.fn()
    // getProgramAccounts, getEpochInfo
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: stakeAccountsResponse() }) })
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: { epoch: 702 } }) })
    // Epoche 700: RPC-Fehler (gepruned)
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ error: { code: -32001, message: 'epoch gepruned' } }) })
    // Epoche 701: null-Eintrag (kein Reward)
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: [null] }) })
    vi.stubGlobal('fetch', fn)

    const rewards = await solanaProvider.fetchStakingRewards!(
      '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
      { lastExternalRef: `sol-reward:${STAKE_ACC}:699` },
    )
    expect(rewards).toEqual([])
  })

  it('ohne Stake-Accounts keine RPC-Calls für Epochen', async () => {
    const fn = mockRpc([[]])
    const rewards = await solanaProvider.fetchStakingRewards!(
      '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
      { lastExternalRef: null },
    )
    expect(rewards).toEqual([])
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
