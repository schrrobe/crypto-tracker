import { afterEach, describe, expect, it, vi } from 'vitest'
import { krakenProvider, krakenSignature, nextKrakenNonce, normalizeKrakenAsset } from './kraken'
import { mockFetch } from './__test-helpers'

// Realistic Kraken balance response (POST /0/private/Balance)
const BALANCE_FIXTURE = {
  error: [],
  result: {
    ZEUR: '1500.0000', // fiat → skipped
    XXBT: '0.5000000000',
    XETH: '2.0000000000',
    SOL: '10.00000000',
    'ETH2.S': '1.0000000000', // staked ETH → ETH
    ADA: '0.00000000', // zero balance → skipped
    KFEE: '155.00', // fee credits → skipped
  },
}

afterEach(() => vi.unstubAllGlobals())

const CREDS = { apiKey: 'test-key', apiSecret: Buffer.from('test-secret').toString('base64') }

describe('krakenSignature', () => {
  it('entspricht dem offiziellen Beispiel aus der Kraken-Doku', () => {
    // https://docs.kraken.com/rest/#section/Authentication/Headers-and-Signature
    const signature = krakenSignature(
      '/0/private/AddOrder',
      'nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25',
      '1616492376594',
      'kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg==',
    )
    expect(signature).toBe('4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ==')
  })
})

describe('nextKrakenNonce', () => {
  it('liefert streng monoton steigende Werte, auch bei gleicher Millisekunde', () => {
    // same wall-clock ms for every call → must still strictly increase
    const a = nextKrakenNonce(1_700_000_000_000)
    const b = nextKrakenNonce(1_700_000_000_000)
    const c = nextKrakenNonce(1_700_000_000_000)
    expect(BigInt(b)).toBeGreaterThan(BigInt(a))
    expect(BigInt(c)).toBeGreaterThan(BigInt(b))
  })
})

describe('normalizeKrakenAsset', () => {
  it('übersetzt Kraken-Altcodes (Spot)', () => {
    expect(normalizeKrakenAsset('XXBT')).toEqual({ symbol: 'BTC', accountType: 'SPOT' })
    expect(normalizeKrakenAsset('XBT')).toEqual({ symbol: 'BTC', accountType: 'SPOT' })
    expect(normalizeKrakenAsset('XETH')).toEqual({ symbol: 'ETH', accountType: 'SPOT' })
    expect(normalizeKrakenAsset('XXDG')).toEqual({ symbol: 'DOGE', accountType: 'SPOT' })
    expect(normalizeKrakenAsset('SOL')).toEqual({ symbol: 'SOL', accountType: 'SPOT' })
  })

  it('leitet aus Suffixen den Kontotyp ab', () => {
    expect(normalizeKrakenAsset('ETH2.S')).toEqual({ symbol: 'ETH', accountType: 'EARN' })
    expect(normalizeKrakenAsset('SOL.S')).toEqual({ symbol: 'SOL', accountType: 'EARN' })
    expect(normalizeKrakenAsset('XBT.M')).toEqual({ symbol: 'BTC', accountType: 'MARGIN' })
    expect(normalizeKrakenAsset('ETH2')).toEqual({ symbol: 'ETH', accountType: 'EARN' })
    // .F = Auto-Earn → EARN, .B = Bonded (tradable) → SPOT
    expect(normalizeKrakenAsset('USDT.F')).toEqual({ symbol: 'USDT', accountType: 'EARN' })
    expect(normalizeKrakenAsset('XBT.B')).toEqual({ symbol: 'BTC', accountType: 'SPOT' })
  })

  it('überspringt Fiat und Fee-Credits', () => {
    expect(normalizeKrakenAsset('ZEUR')).toBeNull()
    expect(normalizeKrakenAsset('ZUSD')).toBeNull()
    expect(normalizeKrakenAsset('EUR')).toBeNull()
    expect(normalizeKrakenAsset('KFEE')).toBeNull()
  })

  it('reicht unbekannte Codes deterministisch durch, ohne sie auf ein falsches bekanntes Symbol zu mappen', () => {
    // Regression guard for CSO-L1: an unknown code must never silently resolve
    // to a *different* known asset (no wrong market). It is passed through
    // verbatim → downstream creates an explicit unmapped asset (no price).
    expect(normalizeKrakenAsset('FOOBAR')).toEqual({ symbol: 'FOOBAR', accountType: 'SPOT' })
    // deterministic: same input → same output, every call
    expect(normalizeKrakenAsset('FOOBAR')).toEqual(normalizeKrakenAsset('FOOBAR'))
    // an unknown code never collides onto a mapped symbol like BTC/ETH
    expect(normalizeKrakenAsset('FOOBAR')!.symbol).not.toBe('BTC')
    // staking suffix on an unknown base still derives the account type, not the symbol
    expect(normalizeKrakenAsset('FOOBAR.S')).toEqual({ symbol: 'FOOBAR', accountType: 'EARN' })
  })
})

describe('krakenProvider.fetchBalances', () => {
  it('normalisiert die Balance-Response', async () => {
    mockFetch(200, BALANCE_FIXTURE)
    const balances = await krakenProvider.fetchBalances(CREDS)

    expect(balances).toContainEqual({ symbol: 'BTC', amount: '0.5000000000', accountType: 'SPOT', meta: { krakenCode: 'XXBT' } })
    expect(balances).toContainEqual({ symbol: 'SOL', amount: '10.00000000', accountType: 'SPOT', meta: { krakenCode: 'SOL' } })
    // ETH (Spot) + staked ETH2.S (Earn) as separate, differently tagged entries
    expect(balances.filter((b) => b.symbol === 'ETH')).toHaveLength(2)
    expect(balances).toContainEqual({ symbol: 'ETH', amount: '1.0000000000', accountType: 'EARN', meta: { krakenCode: 'ETH2.S' } })
    // fiat, fee credits and zero balances are absent
    expect(balances.map((b) => b.symbol)).not.toContain('ADA')
    // XXBT + XETH + SOL + ETH2.S
    expect(balances).toHaveLength(4)
  })

  it('sendet Key, Signatur und Nonce', async () => {
    const fn = mockFetch(200, { error: [], result: {} })
    await krakenProvider.fetchBalances(CREDS)
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.kraken.com/0/private/Balance')
    const headers = init.headers as Record<string, string>
    expect(headers['API-Key']).toBe('test-key')
    expect(headers['API-Sign']).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(String(init.body)).toMatch(/^nonce=\d+$/)

    // Wiring-KAT: the sent signature must equal the pure function applied to the
    // exact path/body/nonce that went over the wire — fails if the wrapper signs
    // the wrong path, body, or a different nonce than the request carries.
    const body = String(init.body)
    const nonce = body.match(/^nonce=(\d+)$/)![1]!
    expect(headers['API-Sign']).toBe(krakenSignature('/0/private/Balance', body, nonce, CREDS.apiSecret))
  })

  it('mappt Auth-Fehler auf INVALID_API_KEY', async () => {
    mockFetch(200, { error: ['EAPI:Invalid key'] })
    await expect(krakenProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  it('mappt Rate-Limit-Fehler', async () => {
    mockFetch(200, { error: ['EAPI:Rate limit exceeded'] })
    await expect(krakenProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('mappt sonstige Kraken-Fehler auf PROVIDER_ERROR', async () => {
    mockFetch(200, { error: ['EService:Unavailable'] })
    await expect(krakenProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })

  it('klassifiziert Auth-Fehler auch bei non-2xx-Status über den Body', async () => {
    // 401 carrying the Kraken error envelope must map to INVALID_API_KEY,
    // not the status-only PROVIDER_ERROR fallback
    mockFetch(401, { error: ['EAPI:Invalid key'] })
    await expect(krakenProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })
})
