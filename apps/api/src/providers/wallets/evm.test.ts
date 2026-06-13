import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeEvmProvider, polygonProvider } from './evm'

const ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const ZERO = '0x' + '0'.repeat(64)

function mockRpc(results: unknown[]) {
  const fn = vi.fn()
  for (const result of results) {
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result }) })
  }
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('makeEvmProvider', () => {
  const provider = makeEvmProvider({
    id: 'POLYGON',
    rpcUrl: 'https://example.invalid',
    nativeSymbol: 'POL',
    tokens: [{ symbol: 'USDC', contract: '0x' + '1'.repeat(40), decimals: 6 }],
  })

  it('liefert native + Token-Bestände, Nullbestände entfallen', async () => {
    mockRpc([
      '0xde0b6b3a7640000', // 1 POL
      '0x' + (5_000_000).toString(16).padStart(64, '0'), // 5 USDC
    ])
    const balances = await provider.fetchBalances(ADDRESS)
    expect(balances).toEqual([
      { symbol: 'POL', amount: '1' },
      { symbol: 'USDC', amount: '5', meta: { contract: '0x' + '1'.repeat(40) } },
    ])
  })

  it('alles 0 → leere Liste', async () => {
    mockRpc(['0x0', ZERO])
    expect(await provider.fetchBalances(ADDRESS)).toEqual([])
  })

  it('validiert 0x-Adressen, wirft RATE_LIMITED bei 429', async () => {
    expect(polygonProvider.validateAddress(ADDRESS)).toBe(true)
    expect(polygonProvider.validateAddress('nope')).toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })))
    await expect(provider.fetchBalances(ADDRESS)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })
})
