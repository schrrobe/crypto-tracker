import { afterEach, describe, expect, it, vi } from 'vitest'
import { cosmosProvider } from './cosmos'
import { ProviderError } from '../provider.types'

// Live-verified address (Binance cold wallet)
const ADDRESS = 'cosmos1fl48vsnmsdzcv85q5d2q4z5ajdha8yu34mf0eh'

// Fixtures based on the real LCD response format (rest.cosmos.directory/cosmoshub) —
// amounts as strings in uatom (1e6)
const BANK_FIXTURE = {
  balances: [
    { denom: 'uatom', amount: '2500000' }, // 2.5 ATOM liquid
    {
      denom: 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2',
      amount: '777',
    }, // IBC token → ignore
  ],
  pagination: { next_key: null, total: '2' },
}

const DELEGATIONS_FIXTURE = {
  delegation_responses: [
    {
      delegation: {
        delegator_address: ADDRESS,
        validator_address: 'cosmosvaloper1sjllsnramtg3ewxqwwrwjxfgc4n4ef9u2lcnj0',
        shares: '1000000.000000000000000000',
      },
      balance: { denom: 'uatom', amount: '1000000' }, // 1 ATOM staked
    },
    {
      delegation: {
        delegator_address: ADDRESS,
        validator_address: 'cosmosvaloper156gqf9837u7d4c4678yt3rl4ls9c5vuursrrzf',
        shares: '500000.000000000000000000',
      },
      balance: { denom: 'uatom', amount: '500000' }, // 0.5 ATOM staked
    },
  ],
  pagination: { next_key: null, total: '2' },
}

const UNBONDING_FIXTURE = {
  unbonding_responses: [{ entries: [{ balance: '750000' }, { balance: '250000' }] }],
}

const EMPTY_UNBONDING = { unbonding_responses: [] }

// Mock depending on the LCD path (bank and staking endpoints are queried in sequence)
function mockLcd(handlers: Record<string, { status: number; body?: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const match = Object.entries(handlers).find(([path]) => String(url).includes(path))
      const { status, body } = match?.[1] ?? { status: 500, body: undefined }
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('cosmosProvider', () => {
  it('akzeptiert Cosmos-Hub-Adressen (cosmos1 + 38 Zeichen)', () => {
    expect(cosmosProvider.validateAddress(ADDRESS)).toBe(true)
    expect(
      cosmosProvider.validateAddress('cosmosvaloper1sjllsnramtg3ewxqwwrwjxfgc4n4ef9u2lcnj0'),
    ).toBe(false) // Validator
    expect(cosmosProvider.validateAddress('osmo1fl48vsnmsdzcv85q5d2q4z5ajdha8yu3rqxy9n')).toBe(
      false,
    ) // different chain
    expect(cosmosProvider.validateAddress('cosmos1zukurz')).toBe(false)
    expect(cosmosProvider.validateAddress('nicht-gueltig')).toBe(false)
  })

  it('summiert liquide, gestakte und unbondende ATOM', async () => {
    mockLcd({
      '/cosmos/bank/v1beta1/balances/': { status: 200, body: BANK_FIXTURE },
      '/cosmos/staking/v1beta1/delegations/': { status: 200, body: DELEGATIONS_FIXTURE },
      '/unbonding_delegations': { status: 200, body: UNBONDING_FIXTURE },
    })
    const balances = await cosmosProvider.fetchBalances(ADDRESS)
    // 2.5 + 1 + 0.5 + 0.75 + 0.25 = 5 ATOM; IBC token is ignored
    expect(balances).toEqual([{ symbol: 'ATOM', amount: '5' }])
  })

  it('liefert nur die Bank-Balance, wenn nichts gestakt ist', async () => {
    mockLcd({
      '/cosmos/bank/v1beta1/balances/': { status: 200, body: BANK_FIXTURE },
      '/cosmos/staking/v1beta1/delegations/': {
        status: 200,
        body: { delegation_responses: [], pagination: { next_key: null, total: '0' } },
      },
      '/unbonding_delegations': { status: 200, body: EMPTY_UNBONDING },
    })
    expect(await cosmosProvider.fetchBalances(ADDRESS)).toEqual([{ symbol: 'ATOM', amount: '2.5' }])
  })

  it('filtert Nullbestände heraus', async () => {
    mockLcd({
      '/cosmos/bank/v1beta1/balances/': {
        status: 200,
        body: { balances: [], pagination: { next_key: null, total: '0' } },
      },
      '/cosmos/staking/v1beta1/delegations/': {
        status: 200,
        body: { delegation_responses: [], pagination: { next_key: null, total: '0' } },
      },
      '/unbonding_delegations': { status: 200, body: EMPTY_UNBONDING },
    })
    expect(await cosmosProvider.fetchBalances(ADDRESS)).toEqual([])
  })

  it('wirft INVALID_ADDRESS bei HTTP 400 (decoding bech32 failed)', async () => {
    mockLcd({
      '/cosmos/bank/v1beta1/balances/': {
        status: 400,
        body: { code: 3, message: 'invalid address: decoding bech32 failed', details: [] },
      },
    })
    await expect(cosmosProvider.fetchBalances('xyz')).rejects.toMatchObject({
      code: 'INVALID_ADDRESS',
    })
  })

  it('wirft RATE_LIMITED bei HTTP 429', async () => {
    mockLcd({ '/cosmos/bank/v1beta1/balances/': { status: 429 } })
    await expect(cosmosProvider.fetchBalances(ADDRESS)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    })
  })

  it('wirft PROVIDER_ERROR bei Serverfehlern der Staking-Endpunkte', async () => {
    mockLcd({ '/cosmos/bank/v1beta1/balances/': { status: 503 } })
    await expect(cosmosProvider.fetchBalances(ADDRESS)).rejects.toBeInstanceOf(ProviderError)
    mockLcd({
      '/cosmos/bank/v1beta1/balances/': { status: 200, body: BANK_FIXTURE },
      '/cosmos/staking/v1beta1/delegations/': { status: 503 },
    })
    await expect(cosmosProvider.fetchBalances(ADDRESS)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    })

    mockLcd({
      '/cosmos/bank/v1beta1/balances/': { status: 200, body: BANK_FIXTURE },
      '/cosmos/staking/v1beta1/delegations/': { status: 200, body: DELEGATIONS_FIXTURE },
      '/unbonding_delegations': { status: 503 },
    })
    await expect(cosmosProvider.fetchBalances(ADDRESS)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    })
  })
})
