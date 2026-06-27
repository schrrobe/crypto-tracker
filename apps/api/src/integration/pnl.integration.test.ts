import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { prisma } from '../lib/prisma'
import { API, app, bearer, registerUser, type TestUser } from './helpers'

async function findAssetId(user: TestUser, symbol: string): Promise<string> {
  const res = await request(app).get(`${API}/assets/search?q=${symbol}`).set(...bearer(user))
  const asset = (res.body.assets as Array<{ id: string; symbol: string }>).find((a) => a.symbol === symbol)
  if (!asset) throw new Error(`Asset ${symbol} nicht im Seed`)
  return asset.id
}

describe('PnL (Integration)', () => {
  it('Pro: unrealisierter G/V aus FIFO-Kostenbasis (Fake-Preise)', async () => {
    const user = await registerUser('pnl') // Default PRO
    const btcId = await findAssetId(user, 'BTC')

    // BUY 1 BTC @ 20.000 € → cost basis 20.000
    await request(app)
      .post(`${API}/transactions`)
      .set(...bearer(user))
      .send({
        assetId: btcId,
        type: 'BUY',
        quantity: '1',
        pricePerUnit: '20000',
        currency: 'EUR',
        timestamp: '2024-01-15T10:00:00.000Z',
      })
      .expect(201)

    // fetch current (fake) prices: BTC = 50.000 €
    await request(app).post(`${API}/prices/refresh`).set(...bearer(user)).expect(200)

    const res = await request(app).get(`${API}/portfolio/pnl`).set(...bearer(user))
    expect(res.status).toBe(200)
    const pos = (res.body.positions as Array<{ assetSymbol: string; costBasisEur: string; valueEur: string; pnlEur: string }>).find(
      (p) => p.assetSymbol === 'BTC',
    )
    expect(pos?.costBasisEur).toBe('20000.00')
    expect(pos?.valueEur).toBe('50000.00')
    expect(pos?.pnlEur).toBe('30000.00')
    expect(res.body.totalPnlEur).toBe('30000.00')
    // Coverage: the BTC position has full tx history → covered, nothing excluded
    expect(res.body.coveredCount).toBe(1)
    expect(res.body.excludedCount).toBe(0)
    expect(res.body.excludedValueEur).toBe('0.00')
  })

  it('Pro: MARGIN/non-spot holdings are excluded from PnL coverage', async () => {
    const user = await registerUser('pnl-margin') // PRO
    const btcId = await findAssetId(user, 'BTC')
    const ethId = await findAssetId(user, 'ETH')

    // SPOT BTC with a real cost basis
    await request(app)
      .post(`${API}/transactions`)
      .set(...bearer(user))
      .send({
        assetId: btcId,
        type: 'BUY',
        quantity: '1',
        pricePerUnit: '20000',
        currency: 'EUR',
        timestamp: '2024-01-15T10:00:00.000Z',
      })
      .expect(201)

    // Inject a MARGIN short on the same user's source — has a price but no spot basis.
    // Before the spot-only scoping this counted as "excluded value" (a liability read
    // as omitted assets); now it must not appear in PnL coverage at all.
    const src = await prisma.portfolioSource.findFirst({ where: { userId: user.userId } })
    await prisma.holding.create({
      data: { sourceId: src!.id, assetId: ethId, accountType: 'MARGIN', quantity: '-5' },
    })

    await request(app).post(`${API}/prices/refresh`).set(...bearer(user)).expect(200)

    const res = await request(app).get(`${API}/portfolio/pnl`).set(...bearer(user))
    expect(res.status).toBe(200)
    expect(res.body.coveredCount).toBe(1) // BTC only
    expect(res.body.excludedCount).toBe(0) // MARGIN not counted as excluded value
    const symbols = (res.body.positions as Array<{ assetSymbol: string }>).map((p) => p.assetSymbol)
    expect(symbols).not.toContain('ETH')
  })

  it('Free: /portfolio/pnl → 402', async () => {
    const user = await registerUser('pnl-free', 'FREE')
    const res = await request(app).get(`${API}/portfolio/pnl`).set(...bearer(user))
    expect(res.status).toBe(402)
    expect(res.body.error.code).toBe('PLAN_UPGRADE_REQUIRED')
    expect(res.body.error.details?.feature).toBe('pnl')
  })
})
