import { afterEach, describe, expect, it, vi } from 'vitest'

// mock env with a beaconcha.in key set — the real test env has none
vi.mock('../../config/env', () => ({
  env: {
    ETH_RPC_URL: 'https://ethereum-rpc.publicnode.com',
    BEACONCHAIN_API_KEY: 'test-key',
  },
}))

import { ethereumProvider } from './ethereum'

const ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const GWEI_PER_ETH = 1_000_000_000
// Active validator: withdrawableepoch is a far-future sentinel → no withdrawal is principal
const ACTIVE = Number.MAX_SAFE_INTEGER
// /validator/{indices} details response marking the given validators as active
const activeDetails = (...idx: number[]) => ({
  status: 'OK',
  data: idx.map((validatorindex) => ({ validatorindex, balance: 32 * GWEI_PER_ETH, withdrawableepoch: ACTIVE })),
})

function mockBeaconchain(responses: Array<{ status: string; data: unknown }>) {
  const fn = vi.fn()
  for (const r of responses) {
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => r })
  }
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('ethereumProvider.fetchStakingRewards (mit API-Key)', () => {
  it('mappt Withdrawals zu Rewards: Gwei→ETH, Epochen-Zeitstempel, externalRef', async () => {
    mockBeaconchain([
      { status: 'OK', data: [{ validatorindex: 123 }] },
      {
        status: 'OK',
        data: [
          // 0.012 ETH reward in epoch 250000
          { epoch: 250_000, amount: 12_000_000, withdrawalindex: 5001, address: ADDRESS },
        ],
      },
    ])

    const rewards = await ethereumProvider.fetchStakingRewards!(ADDRESS, { lastExternalRef: null })

    expect(rewards).toHaveLength(1)
    expect(rewards[0]?.symbol).toBe('ETH')
    expect(rewards[0]?.amount).toBe('0.012')
    expect(rewards[0]?.externalRef).toBe('eth-wd:5001')
    // Beacon genesis 1606824023 + 250000 × 384 s
    expect(rewards[0]?.timestamp.getTime()).toBe((1606824023 + 250_000 * 384) * 1000)
  })

  it('filtert Principal-Auszahlungen (≥ 8 ETH) heraus', async () => {
    mockBeaconchain([
      { status: 'OK', data: [{ validatorindex: 123 }] },
      {
        status: 'OK',
        data: [
          { epoch: 250_000, amount: 10_000_000, withdrawalindex: 1, address: ADDRESS }, // reward
          { epoch: 250_001, amount: 32 * GWEI_PER_ETH, withdrawalindex: 2, address: ADDRESS }, // exit
        ],
      },
    ])
    const rewards = await ethereumProvider.fetchStakingRewards!(ADDRESS, { lastExternalRef: null })
    expect(rewards).toHaveLength(1)
    expect(rewards[0]?.externalRef).toBe('eth-wd:1')
  })

  it('inkrementell: nur Withdrawals nach lastExternalRef', async () => {
    mockBeaconchain([
      { status: 'OK', data: [{ validatorindex: 123 }] },
      {
        status: 'OK',
        data: [
          { epoch: 250_000, amount: 10_000_000, withdrawalindex: 100, address: ADDRESS },
          { epoch: 250_010, amount: 11_000_000, withdrawalindex: 101, address: ADDRESS },
        ],
      },
    ])
    const rewards = await ethereumProvider.fetchStakingRewards!(ADDRESS, {
      lastExternalRef: 'eth-wd:100',
    })
    expect(rewards).toHaveLength(1)
    expect(rewards[0]?.externalRef).toBe('eth-wd:101')
  })

  it('Adresse ohne Validatoren liefert leer', async () => {
    mockBeaconchain([{ status: 'OK', data: [] }])
    const rewards = await ethereumProvider.fetchStakingRewards!(ADDRESS, { lastExternalRef: null })
    expect(rewards).toEqual([])
  })

  it('Principal-Grenze: 8 ETH − 1 Gwei = Reward, exakt 8 ETH = Principal', async () => {
    mockBeaconchain([
      { status: 'OK', data: [{ validatorindex: 1 }] },
      {
        status: 'OK',
        data: [
          { epoch: 250_000, amount: 8 * GWEI_PER_ETH - 1, withdrawalindex: 10, address: ADDRESS }, // reward
          { epoch: 250_000, amount: 8 * GWEI_PER_ETH, withdrawalindex: 11, address: ADDRESS }, // principal
          { epoch: 250_000, amount: 9 * GWEI_PER_ETH, withdrawalindex: 12, address: ADDRESS }, // principal
        ],
      },
    ])
    const rewards = await ethereumProvider.fetchStakingRewards!(ADDRESS, { lastExternalRef: null })
    expect(rewards.map((r) => r.externalRef)).toEqual(['eth-wd:10'])
  })

  it('Pectra: Skim > 8 ETH vor Exit bleibt Reward, Auszahlung ab withdrawableepoch = Principal', async () => {
    mockBeaconchain([
      { status: 'OK', data: [{ validatorindex: 50 }] },
      {
        status: 'OK',
        data: [
          // 12-ETH-Skim VOR dem Exit — die alte 8-ETH-Heuristik hätte ihn fälschlich verworfen
          { epoch: 250_000, amount: 12 * GWEI_PER_ETH, withdrawalindex: 7001, validatorindex: 50, address: ADDRESS },
          // Auszahlung ab withdrawableepoch = Principal
          { epoch: 260_000, amount: 2000 * GWEI_PER_ETH, withdrawalindex: 7002, validatorindex: 50, address: ADDRESS },
        ],
      },
      { status: 'OK', data: [{ validatorindex: 50, balance: 0, withdrawableepoch: 260_000 }] },
    ])
    const rewards = await ethereumProvider.fetchStakingRewards!(ADDRESS, { lastExternalRef: null })
    expect(rewards.map((r) => r.externalRef)).toEqual(['eth-wd:7001'])
    expect(rewards[0]?.amount).toBe('12')
  })

  it('nutzt den Slot-Zeitstempel statt Epochen-Start, wenn vorhanden', async () => {
    const slot = 250_000 * 32 + 17 // konkreter Slot innerhalb der Epoche
    mockBeaconchain([
      { status: 'OK', data: [{ validatorindex: 9 }] },
      {
        status: 'OK',
        data: [{ epoch: 250_000, slot, amount: 1_000_000, withdrawalindex: 8001, validatorindex: 9, address: ADDRESS }],
      },
      activeDetails(9),
    ])
    const rewards = await ethereumProvider.fetchStakingRewards!(ADDRESS, { lastExternalRef: null })
    // Beacon genesis 1606824023 + slot × 12 s (genauer als Epochen-Start)
    expect(rewards[0]?.timestamp.getTime()).toBe((1606824023 + slot * 12) * 1000)
  })

  it('paginiert Withdrawals über volle Seiten (kein stilles Abschneiden)', async () => {
    const page = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        epoch: 250_000,
        amount: 1_000_000, // 0.001 ETH → Reward
        withdrawalindex: from + i,
        address: ADDRESS,
      }))
    mockBeaconchain([
      { status: 'OK', data: [{ validatorindex: 1 }] },
      { status: 'OK', data: page(1, 100) }, // volle Seite → weiterblättern
      { status: 'OK', data: page(101, 50) }, // kurze Seite → Ende
    ])
    const rewards = await ethereumProvider.fetchStakingRewards!(ADDRESS, { lastExternalRef: null })
    expect(rewards).toHaveLength(150)
    expect(rewards[149]?.externalRef).toBe('eth-wd:150')
  })

  it('beaconcha.in Rate-Limit (429) wirft RATE_LIMITED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })),
    )
    await expect(
      ethereumProvider.fetchStakingRewards!(ADDRESS, { lastExternalRef: null }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('beaconcha.in Status ≠ OK wirft PROVIDER_ERROR', async () => {
    mockBeaconchain([
      { status: 'OK', data: [{ validatorindex: 1 }] },
      { status: 'ERROR', data: null },
    ])
    await expect(
      ethereumProvider.fetchStakingRewards!(ADDRESS, { lastExternalRef: null }),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })

  it('404 ohne Validator-Verknüpfung liefert leer (kein Wurf)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    )
    const rewards = await ethereumProvider.fetchStakingRewards!(ADDRESS, { lastExternalRef: null })
    expect(rewards).toEqual([])
  })

  it('fetchBalances ergänzt gestaktes ETH als EARN-Holding (A3)', async () => {
    const fn = vi.fn()
    const reply = (json: unknown) => fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => json })
    reply({ result: '0x29a2241af62c0000' }) // eth_getBalance → 3 ETH
    for (let i = 0; i < 10; i += 1) reply({ result: '0x' + '0'.repeat(64) }) // 10 ERC-20, alle 0
    reply({ status: 'OK', data: [{ validatorindex: 1 }] }) // Validator-Index
    reply({ status: 'OK', data: [{ balance: 32 * GWEI_PER_ETH }] }) // 32 ETH effektiv
    vi.stubGlobal('fetch', fn)

    const balances = await ethereumProvider.fetchBalances(ADDRESS)
    expect(balances).toContainEqual({ symbol: 'ETH', amount: '3' })
    expect(balances).toContainEqual({ symbol: 'ETH', amount: '32', accountType: 'EARN' })
  })
})
