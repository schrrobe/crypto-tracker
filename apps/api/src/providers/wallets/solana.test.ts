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

// Responses in call order: getBalance, getProgramAccounts (Stake), getTokenAccountsByOwner
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
    expect(solanaProvider.validateAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(false) // l/0 not in Base58
    expect(solanaProvider.validateAddress('zu-kurz')).toBe(false)
  })

  it('liefert SOL- und SPL-Bestände mit Mint-Mapping', async () => {
    mockRpc([
      { value: 2_500_000_000 }, // 2.5 SOL
      [], // no stake accounts
      {
        value: [
          tokenAccount(USDC_MINT, '12500000', 6), // 12.5 USDC
          tokenAccount(UNKNOWN_MINT, '7000000000', 9), // 7 of an unknown token
        ],
      },
    ])

    const balances = await solanaProvider.fetchBalances('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', {
      includeUnknownTokens: true,
    })

    expect(balances).toContainEqual({ symbol: 'SOL', amount: '2.5' })
    expect(balances).toContainEqual({ symbol: 'USDC', amount: '12.5', meta: { mint: USDC_MINT } })
    // Unknown mint → short form as symbol, stays unmapped (no price)
    expect(balances).toContainEqual({
      symbol: 'So11…1112',
      amount: '7',
      meta: { mint: UNKNOWN_MINT },
    })
  })

  it('Dust-Filter (Default): unbekannte Mints werden übersprungen', async () => {
    mockRpc([
      { value: 2_500_000_000 },
      [], // no stake accounts
      {
        value: [
          tokenAccount(USDC_MINT, '12500000', 6),
          tokenAccount(UNKNOWN_MINT, '7000000000', 9), // spam — gets filtered out
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
      { value: 1_000_000_000 }, // 1 SOL liquid
      [
        { account: { lamports: 5_000_000_000 } }, // 5 SOL staked
        { account: { lamports: 2_500_000_000 } }, // 2.5 SOL staked
      ],
      { value: [] },
    ])
    const balances = await solanaProvider.fetchBalances('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')
    // 1 + 5 + 2.5 = 8.5 SOL total
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
      { epoch: 702 }, // getEpochInfo → last completed epoch 701
      [{ amount: 50_000_000, effectiveSlot: 300000000 }], // getInflationReward epoch 700
      1709251200, // getBlockTime
      [{ amount: 70_000_000, effectiveSlot: 300432000 }], // epoch 701
      1709424000,
    ])

    const rewards = await solanaProvider.fetchStakingRewards!(
      '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
      // incremental: last known epoch 699 → query from 700 onward
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
    // epoch 700: RPC error (pruned)
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ error: { code: -32001, message: 'epoch gepruned' } }) })
    // epoch 701: null entry (no reward)
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

  it('stoppt bei transientem Fehler (429) statt die Epoche zu überspringen', async () => {
    const fn = vi.fn()
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: stakeAccountsResponse() }) })
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: { epoch: 703 } }) }) // → 700..702
    // epoch 700: reward + Blockzeit
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: [{ amount: 50_000_000, effectiveSlot: 300000000 }] }) })
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: 1709251200 }) })
    // epoch 701: Rate-Limit → muss abbrechen, NICHT zu 702 weiterspringen
    fn.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
    // epoch 702 würde hier liegen — darf nicht abgefragt werden
    vi.stubGlobal('fetch', fn)

    const rewards = await solanaProvider.fetchStakingRewards!(
      '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
      { lastExternalRef: `sol-reward:${STAKE_ACC}:699` },
    )

    // nur die Epoche vor dem transienten Fehler — der Cursor rückt nicht über 701 hinaus
    expect(rewards).toEqual([
      { symbol: 'SOL', amount: '0.05', timestamp: new Date(1709251200 * 1000), externalRef: `sol-reward:${STAKE_ACC}:700` },
    ])
    // getProgramAccounts, getEpochInfo, infl@700, blockTime@700, infl@701(429) → 5; 702 nie abgefragt
    expect(fn).toHaveBeenCalledTimes(5)
  })

  it('verwirft die Epoche nicht still bei getBlockTime-Rate-Limit', async () => {
    const fn = vi.fn()
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: stakeAccountsResponse() }) })
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: { epoch: 701 } }) }) // → nur 700
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: [{ amount: 50_000_000, effectiveSlot: 300000000 }] }) })
    fn.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) }) // getBlockTime 429
    vi.stubGlobal('fetch', fn)

    const rewards = await solanaProvider.fetchStakingRewards!(
      '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
      { lastExternalRef: `sol-reward:${STAKE_ACC}:699` },
    )
    // kein Zeitstempel → kein Eintrag; Epoche 700 wird beim nächsten Sync erneut versucht
    expect(rewards).toEqual([])
  })

  it('bricht bei fehlender Blockzeit (null) ab statt die Epoche still zu überspringen', async () => {
    const fn = vi.fn()
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: stakeAccountsResponse() }) })
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: { epoch: 703 } }) }) // → 700..702
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: [{ amount: 50_000_000, effectiveSlot: 300000000 }] }) })
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: null }) }) // getBlockTime → null
    vi.stubGlobal('fetch', fn)

    const rewards = await solanaProvider.fetchStakingRewards!(
      '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
      { lastExternalRef: `sol-reward:${STAKE_ACC}:699` },
    )
    // Epoche 700 wird zurückgestellt, NICHT zu 701/702 übersprungen
    expect(rewards).toEqual([])
    // getProgramAccounts, getEpochInfo, infl@700, blockTime@700(null) → 4; 701/702 nie abgefragt
    expect(fn).toHaveBeenCalledTimes(4)
  })
})
