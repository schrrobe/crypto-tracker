import { afterEach, describe, expect, it, vi } from 'vitest'
import { xrpProvider } from './xrp'
import { ProviderError } from '../provider.types'

// Live verifizierte Adresse (Binance-Hot-Wallet)
const ADDRESS = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh'

// Fixture nach echtem Ripple-JSON-RPC-Format (account_info, validierter Ledger) —
// Balance als String in Drops (1e6)
const ACCOUNT_INFO_FIXTURE = {
  result: {
    account_data: {
      Account: ADDRESS,
      Balance: '99999000',
      Flags: 131072,
      LedgerEntryType: 'AccountRoot',
      OwnerCount: 0,
      Sequence: 568836,
    },
    ledger_index: 104884676,
    validated: true,
    status: 'success',
  },
}

// Konto nie aktiviert (10-XRP-Reserve nie eingezahlt) — kommt mit HTTP 200
const ACT_NOT_FOUND_FIXTURE = {
  result: {
    error: 'actNotFound',
    error_code: 19,
    error_message: 'Account not found.',
    status: 'error',
    type: 'response',
  },
}

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

describe('xrpProvider', () => {
  it('akzeptiert Classic-Adressen (r…)', () => {
    expect(xrpProvider.validateAddress(ADDRESS)).toBe(true)
    expect(xrpProvider.validateAddress('rrrrrrrrrrrrrrrrrrrrrhoLvTp')).toBe(true) // ACCOUNT_ZERO
    expect(xrpProvider.validateAddress('XVLhHMPHU98es4dbozjVtdWzVrDjtV18pX8yuPT7y4xaEHi')).toBe(false) // X-Address
    expect(xrpProvider.validateAddress('0x71C7656EC7ab88b098defB751B7401B5f6d8976F')).toBe(false)
    expect(xrpProvider.validateAddress('nicht-gueltig')).toBe(false)
  })

  it('liefert die XRP-Balance in Drops umgerechnet', async () => {
    mockFetch(200, ACCOUNT_INFO_FIXTURE)
    const balances = await xrpProvider.fetchBalances(ADDRESS)
    expect(balances).toEqual([{ symbol: 'XRP', amount: '99.999' }])
  })

  it('behandelt actNotFound als leeres Wallet (Konto nicht aktiviert)', async () => {
    mockFetch(200, ACT_NOT_FOUND_FIXTURE)
    expect(await xrpProvider.fetchBalances(ADDRESS)).toEqual([])
  })

  it('wirft INVALID_ADDRESS bei actMalformed', async () => {
    mockFetch(200, {
      result: { error: 'actMalformed', error_code: 35, error_message: 'accountMalformed', status: 'error' },
    })
    await expect(xrpProvider.fetchBalances('xyz')).rejects.toMatchObject({
      code: 'INVALID_ADDRESS',
    })
  })

  it('wirft PROVIDER_ERROR bei sonstigen RPC-Fehlern', async () => {
    mockFetch(200, {
      result: { error: 'invalidParams', error_message: 'Invalid parameters.', status: 'error' },
    })
    await expect(xrpProvider.fetchBalances(ADDRESS)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    })
  })

  it('wirft RATE_LIMITED bei HTTP 429', async () => {
    mockFetch(429)
    await expect(xrpProvider.fetchBalances(ADDRESS)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    })
  })

  it('wirft PROVIDER_ERROR bei Serverfehlern', async () => {
    mockFetch(503)
    await expect(xrpProvider.fetchBalances(ADDRESS)).rejects.toBeInstanceOf(ProviderError)
    mockFetch(503)
    await expect(xrpProvider.fetchBalances(ADDRESS)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    })
  })
})
