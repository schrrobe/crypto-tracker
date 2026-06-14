import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { API, app, bearer, createExchangeSource, registerUser } from './helpers'

// FAKE_PROVIDERS fetchAccount: SPOT 0.1 BTC + 2 ETH, EARN 0.05 BTC, MARGIN -300 USDT,
// 2 futures positions (BTC LONG, ETH SHORT). Prices (FAKE): BTC 50k€, ETH 1€?, USDT 0.9€.

type Holding = { asset: { symbol: string }; accountType: string; quantity: string; valueEur: string | null }

async function syncedSource(prefix: string, apiKey = 'valid-key-1234') {
  const user = await registerUser(prefix)
  const source = await createExchangeSource(user, 'Multi', apiKey, 'BINANCE')
  const run = await request(app).post(`${API}/sources/${source.id}/sync`).set(...bearer(user))
  return { user, source, run }
}

describe('Account-Types (Integration)', () => {
  it('persistiert accountType und listet ein Asset unter mehreren Kontotypen', async () => {
    const { user } = await syncedSource('acct')
    const holdings = (await request(app).get(`${API}/holdings`).set(...bearer(user))).body.holdings as Holding[]

    const btc = holdings.filter((h) => h.asset.symbol === 'BTC').map((h) => h.accountType).sort()
    expect(btc).toEqual(['EARN', 'SPOT']) // same asset, two account types
    expect(holdings.find((h) => h.asset.symbol === 'USDT')?.accountType).toBe('MARGIN')
  })

  it('bewertet negative Margin-Bestände negativ und nettet sie im Gesamtwert', async () => {
    const { user } = await syncedSource('acctneg')
    const holdings = (await request(app).get(`${API}/holdings`).set(...bearer(user))).body.holdings as Holding[]
    const usdt = holdings.find((h) => h.asset.symbol === 'USDT')
    // -300 USDT × 0.9 € = -270 €
    expect(usdt?.quantity).toBe('-300')
    expect(Number(usdt?.valueEur)).toBeCloseTo(-270, 2)

    const summary = (await request(app).get(`${API}/portfolio/summary`).set(...bearer(user))).body
    // MARGIN lowers the net total
    const margin = (summary.byAccountType as Array<{ accountType: string; valueEur: string }>).find(
      (r) => r.accountType === 'MARGIN',
    )
    expect(Number(margin?.valueEur)).toBeCloseTo(-270, 2)
    const earn = (summary.byAccountType as Array<{ accountType: string; valueEur: string }>).find(
      (r) => r.accountType === 'EARN',
    )
    expect(earn).toBeDefined()
  })

  it('liefert Futures-Positionen und hält uPnL aus dem Gesamtwert heraus', async () => {
    const { user } = await syncedSource('acctfut')
    const positions = (await request(app).get(`${API}/portfolio/futures`).set(...bearer(user))).body
      .positions as Array<{ assetSymbol: string; side: string; unrealizedPnlEur: string | null; valueEur: string | null }>
    expect(positions).toHaveLength(2)
    const btc = positions.find((p) => p.assetSymbol === 'BTC')
    expect(btc?.side).toBe('LONG')
    // uPnL 40 USDT × 0.9 € = 36 €
    expect(Number(btc?.unrealizedPnlEur)).toBeCloseTo(36, 2)

    const summary = (await request(app).get(`${API}/portfolio/summary`).set(...bearer(user))).body
    // uPnL sum (40+100) USDT × 0.9 = 126 €, reported separately
    expect(Number(summary.futuresUnrealizedPnlEur)).toBeCloseTo(126, 2)
    // Total does NOT include the uPnL (holdings only)
    const sumHoldings = (summary.byAccountType as Array<{ valueEur: string }>).reduce(
      (s, r) => s + Number(r.valueEur),
      0,
    )
    expect(Number(summary.totalEur)).toBeCloseTo(sumHoldings, 2)
  })

  it('Re-Sync ersetzt die Futures-Positionen (kein Duplizieren)', async () => {
    const { user, source } = await syncedSource('acctresync')
    await request(app).post(`${API}/sources/${source.id}/sync`).set(...bearer(user))
    const positions = (await request(app).get(`${API}/portfolio/futures`).set(...bearer(user))).body.positions
    expect(positions).toHaveLength(2)
  })

  it('Teil-Erfolg: gesperrter EARN-Endpoint → Spot synct, SyncRun PARTIAL_SYNC', async () => {
    const { user, run } = await syncedSource('acctpartial', 'FORBIDDEN-EARN-key')
    expect(run.body.run.status).toBe('SUCCESS')
    expect(run.body.run.errorCode).toBe('PARTIAL_SYNC')

    const holdings = (await request(app).get(`${API}/holdings`).set(...bearer(user))).body.holdings as Holding[]
    // Spot/Margin present, EARN missing
    expect(holdings.some((h) => h.accountType === 'SPOT')).toBe(true)
    expect(holdings.some((h) => h.accountType === 'EARN')).toBe(false)
  })
})
