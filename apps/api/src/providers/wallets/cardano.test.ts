import { afterEach, describe, expect, it, vi } from 'vitest'
import { cardanoProvider } from './cardano'
import { ProviderError } from '../provider.types'

// Live-verified address (output of a recent mainnet transaction)
const ADDRESS = 'addr1vy7p9anntmu8v4w9kfaua5lc9rv9059z0lfq7tx6rr4l97c9w4kcq'

// Fixture based on the real Koios response format (POST /api/v1/address_info) —
// balance as a string in Lovelace (1e6)
const ADDRESS_INFO_FIXTURE = [
  {
    address: ADDRESS,
    balance: '3044539404',
    stake_address: null,
    script_address: false,
    utxo_set: [
      {
        value: '3044539404',
        tx_hash: 'a4803e168162e4317b7c492188757b8b64c1cd50c4ad00bb0cf88604fe78b3fc',
        tx_index: 1,
        asset_list: [],
        block_time: 1781311646,
        block_height: 13542534,
      },
    ],
  },
]

function mockFetch(status: number, body?: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('cardanoProvider', () => {
  it('akzeptiert Shelley-Adressen (addr1…)', () => {
    expect(cardanoProvider.validateAddress(ADDRESS)).toBe(true) // Enterprise (58 characters)
    expect(
      cardanoProvider.validateAddress(
        // Base address (103 characters): addr1 + 98 characters
        `addr1${'q'.repeat(98)}`,
      ),
    ).toBe(true)
    expect(cardanoProvider.validateAddress('addr1zukurz')).toBe(false)
    expect(cardanoProvider.validateAddress('stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw')).toBe(false)
    expect(cardanoProvider.validateAddress('DdzFFzCqrht...')).toBe(false) // Byron era
    expect(cardanoProvider.validateAddress('nicht-gueltig')).toBe(false)
  })

  it('liefert die ADA-Balance in Lovelace umgerechnet', async () => {
    mockFetch(200, ADDRESS_INFO_FIXTURE)
    const balances = await cardanoProvider.fetchBalances(ADDRESS)
    expect(balances).toEqual([{ symbol: 'ADA', amount: '3044.539404' }])
  })

  it('sendet die Adresse im Koios-Body-Format', async () => {
    mockFetch(200, ADDRESS_INFO_FIXTURE)
    await cardanoProvider.fetchBalances(ADDRESS)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body: JSON.stringify({ _addresses: [ADDRESS] }) }),
    )
  })

  it('behandelt leeres Array als leeres Wallet (Koios kennt die Adresse nicht)', async () => {
    mockFetch(200, [])
    expect(await cardanoProvider.fetchBalances(ADDRESS)).toEqual([])
  })

  it('filtert Nullbestände heraus', async () => {
    mockFetch(200, [{ address: ADDRESS, balance: '0', stake_address: null, script_address: false, utxo_set: [] }])
    expect(await cardanoProvider.fetchBalances(ADDRESS)).toEqual([])
  })

  it('wirft RATE_LIMITED bei HTTP 429', async () => {
    mockFetch(429)
    await expect(cardanoProvider.fetchBalances(ADDRESS)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    })
  })

  it('wirft INVALID_ADDRESS bei HTTP 4xx', async () => {
    mockFetch(400)
    await expect(cardanoProvider.fetchBalances('xyz')).rejects.toMatchObject({
      code: 'INVALID_ADDRESS',
    })
  })

  it('wirft PROVIDER_ERROR bei Serverfehlern', async () => {
    mockFetch(503)
    await expect(cardanoProvider.fetchBalances(ADDRESS)).rejects.toBeInstanceOf(ProviderError)
    mockFetch(503)
    await expect(cardanoProvider.fetchBalances(ADDRESS)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    })
  })
})
