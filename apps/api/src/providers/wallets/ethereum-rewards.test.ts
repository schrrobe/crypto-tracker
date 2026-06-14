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
})
