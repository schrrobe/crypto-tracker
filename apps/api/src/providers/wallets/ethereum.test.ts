import { afterEach, describe, expect, it, vi } from 'vitest'
import { ethereumProvider } from './ethereum'

const ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

// Responses in call order: eth_getBalance, then one eth_call per KNOWN_TOKEN
function mockRpc(results: unknown[]) {
  const fn = vi.fn()
  for (const result of results) {
    fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result }) })
  }
  vi.stubGlobal('fetch', fn)
  return fn
}

const ZERO = '0x' + '0'.repeat(64)
// 10 curated tokens — all 0 except at targeted positions
function tokenResults(overrides: Record<number, string> = {}): string[] {
  return Array.from({ length: 10 }, (_, i) => overrides[i] ?? ZERO)
}

afterEach(() => vi.unstubAllGlobals())

describe('ethereumProvider', () => {
  it('validiert 0x-Adressen', () => {
    expect(ethereumProvider.validateAddress(ADDRESS)).toBe(true)
    expect(ethereumProvider.validateAddress('0x1234')).toBe(false)
    expect(ethereumProvider.validateAddress('d8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(false)
    expect(ethereumProvider.validateAddress('0xZZdA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(false)
  })

  it('liefert ETH (Wei→18) und kuratierte ERC-20-Bestände, 0-Bestände entfallen', async () => {
    mockRpc([
      '0x29a2241af62c0000', // 3 ETH
      // Token 0 = USDC (6 decimals): 25 USDC; Token 5 = STETH (18): 1.5
      ...tokenResults({
        0: '0x' + (25_000_000).toString(16).padStart(64, '0'),
        5: '0x' + (1_500_000_000_000_000_000n).toString(16).padStart(64, '0'),
      }),
    ])

    const balances = await ethereumProvider.fetchBalances(ADDRESS)

    expect(balances).toContainEqual({ symbol: 'ETH', amount: '3' })
    expect(balances.find((b) => b.symbol === 'USDC')?.amount).toBe('25')
    expect(balances.find((b) => b.symbol === 'STETH')?.amount).toBe('1.5')
    // only ETH + 2 tokens — zero balances do not appear
    expect(balances).toHaveLength(3)
  })

  it('leeres eth_call-Ergebnis ("0x") zählt als 0', async () => {
    mockRpc(['0x0', ...Array.from({ length: 10 }, () => '0x')])
    const balances = await ethereumProvider.fetchBalances(ADDRESS)
    expect(balances).toHaveLength(0)
  })

  it('wirft RATE_LIMITED bei 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })))
    await expect(ethereumProvider.fetchBalances(ADDRESS)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })
})

describe('ethereumProvider.fetchStakingRewards', () => {
  it('ohne BEACONCHAIN_API_KEY keine Abfrage (leeres Ergebnis)', async () => {
    const fn = vi.fn()
    vi.stubGlobal('fetch', fn)
    const rewards = await ethereumProvider.fetchStakingRewards!(ADDRESS, { lastExternalRef: null })
    expect(rewards).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })
})
