import { afterEach, describe, expect, it, vi } from 'vitest'
import { solanaProvider } from './solana'

const ADDRESS = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const UNKNOWN_MINT = 'So11111111111111111111111111111111111111112'

function tokenAccount(mint: string, amount: string, decimals: number) {
  return {
    account: {
      data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } },
    },
  }
}

// httpRaw reads res.text(); these mocks mirror fetch's Response shape.
function ok(result: unknown) {
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ result }) }
}
function rpcError(message: string) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ error: { code: -32001, message } }),
  }
}
function httpError(status: number) {
  return { ok: false, status, headers: { get: () => null }, text: async () => '{}' }
}

// Balance path is sequential: getBalance, getProgramAccounts (Stake), getTokenAccountsByOwner.
function mockRpc(results: unknown[]) {
  const fn = vi.fn()
  for (const result of results) fn.mockResolvedValueOnce(ok(result))
  vi.stubGlobal('fetch', fn)
  return fn
}

// The reward backfill resolves getBlockTime concurrently, so order is not stable —
// dispatch by RPC method (and epoch/slot) instead of by call sequence.
type Reply = { result: unknown } | { error: string } | { httpStatus: number }
function reply(r: Reply) {
  if ('httpStatus' in r) return httpError(r.httpStatus)
  if ('error' in r) return rpcError(r.error)
  return ok(r.result)
}
function mockSolana(opts: {
  stakeAccounts: unknown
  epochInfo?: Reply
  inflationReward?: Record<number, Reply>
  blockTime?: Record<number, Reply>
}) {
  const fn = vi.fn(async (_url: string, init: { body: string }) => {
    const { method, params } = JSON.parse(init.body) as { method: string; params: unknown[] }
    switch (method) {
      case 'getProgramAccounts':
        return reply({ result: opts.stakeAccounts })
      case 'getEpochInfo':
        return reply(opts.epochInfo ?? { result: { epoch: 0 } })
      case 'getInflationReward': {
        const epoch = (params[1] as { epoch: number }).epoch
        return reply(opts.inflationReward?.[epoch] ?? { result: [null] })
      }
      case 'getBlockTime': {
        const slot = params[0] as number
        return reply(opts.blockTime?.[slot] ?? { result: null })
      }
      default:
        return reply({ result: null })
    }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('solanaProvider', () => {
  it('validiert Base58-Adressen', () => {
    expect(solanaProvider.validateAddress(ADDRESS)).toBe(true)
    expect(solanaProvider.validateAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(false) // l/0 not in Base58
    expect(solanaProvider.validateAddress('zu-kurz')).toBe(false)
  })

  it('weist eine ungültige Adresse ab, bevor ein Request rausgeht', async () => {
    const fn = vi.fn()
    vi.stubGlobal('fetch', fn)
    await expect(solanaProvider.fetchBalances('zu-kurz')).rejects.toMatchObject({ code: 'INVALID_ADDRESS' })
    expect(fn).not.toHaveBeenCalled()
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

    const balances = await solanaProvider.fetchBalances(ADDRESS, { includeUnknownTokens: true })

    expect(balances).toContainEqual({ symbol: 'SOL', amount: '2.5' })
    expect(balances).toContainEqual({ symbol: 'USDC', amount: '12.5', meta: { mint: USDC_MINT } })
    // Unknown mint → short form as symbol (6+6 base58 chars), stays unmapped (no price)
    expect(balances).toContainEqual({ symbol: 'So1111…111112', amount: '7', meta: { mint: UNKNOWN_MINT } })
  })

  it('pinnt das Commitment auf finalized', async () => {
    const fn = mockRpc([{ value: 0 }, [], { value: [] }])
    await solanaProvider.fetchBalances(ADDRESS)
    const balanceCall = fn.mock.calls.find(([, init]) => JSON.parse((init as { body: string }).body).method === 'getBalance')
    expect(balanceCall).toBeDefined()
    const body = JSON.parse((balanceCall![1] as { body: string }).body)
    expect(body.params).toContainEqual({ commitment: 'finalized' })
  })

  it('liest große lamports-Balances verlustfrei (> 2^53)', async () => {
    // 9007199254740993 = 2^53 + 1. JSON.parse would round this to ...992 (float64);
    // the lossless text read keeps the trailing 3. Written as a raw string so the
    // test fixture itself doesn't lose the bit.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const { method } = JSON.parse(init.body) as { method: string }
        if (method === 'getBalance') {
          return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async () => '{"result":{"context":{"slot":1},"value":9007199254740993}}',
          }
        }
        if (method === 'getProgramAccounts') return ok([])
        return ok({ value: [] })
      }),
    )
    const balances = await solanaProvider.fetchBalances(ADDRESS)
    expect(balances).toEqual([{ symbol: 'SOL', amount: '9007199.254740993' }])
  })

  it('Dust-Filter (Default): unbekannte Mints werden übersprungen', async () => {
    mockRpc([
      { value: 2_500_000_000 },
      [],
      {
        value: [tokenAccount(USDC_MINT, '12500000', 6), tokenAccount(UNKNOWN_MINT, '7000000000', 9)],
      },
    ])

    const balances = await solanaProvider.fetchBalances(ADDRESS)

    expect(balances).toContainEqual({ symbol: 'SOL', amount: '2.5' })
    expect(balances).toContainEqual({ symbol: 'USDC', amount: '12.5', meta: { mint: USDC_MINT } })
    expect(balances.find((b) => b.meta?.mint === UNKNOWN_MINT)).toBeUndefined()
  })

  it('summiert mehrere Token-Accounts mit demselben Mint', async () => {
    mockRpc([
      { value: 0 },
      [],
      { value: [tokenAccount(USDC_MINT, '1000000', 6), tokenAccount(USDC_MINT, '2500000', 6)] },
    ])
    const balances = await solanaProvider.fetchBalances(ADDRESS)
    expect(balances).toContainEqual({ symbol: 'USDC', amount: '3.5', meta: { mint: USDC_MINT } })
  })

  it('lässt Token-Accounts mit Bestand 0 weg', async () => {
    mockRpc([{ value: 0 }, [], { value: [tokenAccount(USDC_MINT, '0', 6)] }])
    const balances = await solanaProvider.fetchBalances(ADDRESS)
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
    const balances = await solanaProvider.fetchBalances(ADDRESS)
    // 1 + 5 + 2.5 = 8.5 SOL total
    expect(balances).toEqual([{ symbol: 'SOL', amount: '8.5' }])
  })

  it('liest Stake-Account-lamports jenseits von 2^53 verlustfrei', async () => {
    // 9007199254740993 = 2^53 + 1: through solanaRpc/JSON.parse this would round to
    // ...992 and yield a wrong staked total. Raw-text lossless parse keeps the bit.
    // Written as a raw response string so the fixture itself doesn't lose it.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const { method } = JSON.parse(init.body) as { method: string }
        if (method === 'getBalance') return ok({ value: 0 })
        if (method === 'getProgramAccounts') {
          return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async () => '{"result":[{"pubkey":"X","account":{"lamports":9007199254740993}}]}',
          }
        }
        return ok({ value: [] })
      }),
    )
    const balances = await solanaProvider.fetchBalances(ADDRESS)
    expect(balances).toEqual([{ symbol: 'SOL', amount: '9007199.254740993' }])
  })

  it('wirft PROVIDER_ERROR bei RPC-Fehler-Antwort', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => rpcError('Invalid param')))
    await expect(solanaProvider.fetchBalances(ADDRESS)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })
})

describe('solanaProvider.fetchStakingRewards', () => {
  const STAKE_ACC = 'StakeAcc111111111111111111111111111111111111'
  const SINCE = { lastExternalRef: `sol-reward:${STAKE_ACC}:699` }

  function stakeAccountsResponse() {
    return [{ pubkey: STAKE_ACC, account: { lamports: 5_000_000_000 } }]
  }

  it('liefert Rewards pro Epoche mit externalRef und Block-Zeitstempel', async () => {
    mockSolana({
      stakeAccounts: stakeAccountsResponse(),
      epochInfo: { result: { epoch: 702 } }, // last completed epoch 701
      inflationReward: {
        700: { result: [{ amount: 50_000_000, effectiveSlot: 300000000 }] },
        701: { result: [{ amount: 70_000_000, effectiveSlot: 300432000 }] },
      },
      blockTime: { 300000000: { result: 1709251200 }, 300432000: { result: 1709424000 } },
    })

    const rewards = await solanaProvider.fetchStakingRewards!(ADDRESS, SINCE)

    expect(rewards).toEqual([
      { symbol: 'SOL', amount: '0.05', timestamp: new Date(1709251200 * 1000), externalRef: `sol-reward:${STAKE_ACC}:700` },
      { symbol: 'SOL', amount: '0.07', timestamp: new Date(1709424000 * 1000), externalRef: `sol-reward:${STAKE_ACC}:701` },
    ])
  })

  it('überspringt nicht verfügbare Epochen und Null-Einträge', async () => {
    mockSolana({
      stakeAccounts: stakeAccountsResponse(),
      epochInfo: { result: { epoch: 702 } }, // → 700, 701
      inflationReward: {
        700: { error: 'epoch gepruned' }, // pruned → skip forward
        701: { result: [null] }, // no reward
      },
    })
    const rewards = await solanaProvider.fetchStakingRewards!(ADDRESS, SINCE)
    expect(rewards).toEqual([])
  })

  it('ohne Stake-Accounts keine RPC-Calls für Epochen', async () => {
    const fn = mockSolana({ stakeAccounts: [] })
    const rewards = await solanaProvider.fetchStakingRewards!(ADDRESS, { lastExternalRef: null })
    expect(rewards).toEqual([])
    expect(fn).toHaveBeenCalledTimes(1) // only getProgramAccounts
  })

  it('stoppt bei transientem Fehler (429) statt die Epoche zu überspringen', async () => {
    mockSolana({
      stakeAccounts: stakeAccountsResponse(),
      epochInfo: { result: { epoch: 703 } }, // → 700, 701, 702
      inflationReward: {
        700: { result: [{ amount: 50_000_000, effectiveSlot: 300000000 }] },
        701: { httpStatus: 429 }, // transient → stop, do NOT advance to 702
      },
      blockTime: { 300000000: { result: 1709251200 } },
    })

    // Truncated import → throws a partial error carrying the already-collected epoch
    // 700 (the sync persists it + flags PARTIAL_SYNC). Cursor stays at 700.
    await expect(solanaProvider.fetchStakingRewards!(ADDRESS, SINCE)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      partialRewards: [
        { symbol: 'SOL', amount: '0.05', timestamp: new Date(1709251200 * 1000), externalRef: `sol-reward:${STAKE_ACC}:700` },
      ],
    })
  })

  it('verwirft die Epoche nicht still bei getBlockTime-Rate-Limit', async () => {
    mockSolana({
      stakeAccounts: stakeAccountsResponse(),
      epochInfo: { result: { epoch: 701 } }, // → only 700
      inflationReward: { 700: { result: [{ amount: 50_000_000, effectiveSlot: 300000000 }] } },
      blockTime: { 300000000: { httpStatus: 429 } }, // getBlockTime 429
    })

    // Block-time rate limit → partial failure with no collected rewards; epoch 700 is
    // retried on the next sync (cursor does not advance).
    await expect(solanaProvider.fetchStakingRewards!(ADDRESS, SINCE)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      partialRewards: [],
    })
  })

  it('bricht bei fehlender Blockzeit (null) ab statt die Epoche still zu überspringen', async () => {
    mockSolana({
      stakeAccounts: stakeAccountsResponse(),
      epochInfo: { result: { epoch: 701 } }, // → only 700
      inflationReward: { 700: { result: [{ amount: 50_000_000, effectiveSlot: 300000000 }] } },
      blockTime: { 300000000: { result: null } }, // getBlockTime → null
    })

    await expect(solanaProvider.fetchStakingRewards!(ADDRESS, SINCE)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      partialRewards: [],
    })
  })

  it('truncates am ersten Blockzeit-Loch und behält frühere Epochen (Kontiguität)', async () => {
    // 700, 701, 702 all have rewards, but the block time for 701 is missing. We keep
    // 700 and stop — 702 is dropped even though ITS block time was fine, because the
    // cursor must never jump the 701 gap.
    mockSolana({
      stakeAccounts: stakeAccountsResponse(),
      epochInfo: { result: { epoch: 703 } }, // → 700, 701, 702
      inflationReward: {
        700: { result: [{ amount: 50_000_000, effectiveSlot: 100 }] },
        701: { result: [{ amount: 60_000_000, effectiveSlot: 200 }] },
        702: { result: [{ amount: 70_000_000, effectiveSlot: 300 }] },
      },
      blockTime: { 100: { result: 1709251200 }, 200: { result: null }, 300: { result: 1709500000 } },
    })

    await expect(solanaProvider.fetchStakingRewards!(ADDRESS, SINCE)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      partialRewards: [
        { symbol: 'SOL', amount: '0.05', timestamp: new Date(1709251200 * 1000), externalRef: `sol-reward:${STAKE_ACC}:700` },
      ],
    })
  })
})
