import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { API, app, bearer, registerUser, type TestUser } from './helpers'

async function findAssetId(user: TestUser, symbol: string): Promise<string> {
  const res = await request(app).get(`${API}/assets/search?q=${symbol}`).set(...bearer(user))
  const asset = (res.body.assets as Array<{ id: string; symbol: string }>).find((a) => a.symbol === symbol)
  if (!asset) throw new Error(`Asset ${symbol} nicht im Seed`)
  return asset.id
}

async function createTx(user: TestUser, body: Record<string, unknown>): Promise<string> {
  const res = await request(app).post(`${API}/transactions`).set(...bearer(user)).send(body)
  expect(res.status).toBe(201)
  return res.body.transaction.id as string
}

describe('Swap-Link (Integration)', () => {
  it('verknüpft SELL+BUY, DTO zeigt den Tausch, AT-Report schiebt auf', async () => {
    const user = await registerUser('swap') // Default PRO (tax report)
    const btc = await findAssetId(user, 'BTC')
    const eth = await findAssetId(user, 'ETH')

    await createTx(user, { assetId: btc, type: 'BUY', quantity: '1', pricePerUnit: '20000', currency: 'EUR', timestamp: '2024-01-01T00:00:00.000Z' })
    const sellId = await createTx(user, { assetId: btc, type: 'SELL', quantity: '1', pricePerUnit: '25000', currency: 'EUR', timestamp: '2024-06-01T00:00:00.000Z' })
    const buyId = await createTx(user, { assetId: eth, type: 'BUY', quantity: '10', pricePerUnit: '2500', currency: 'EUR', timestamp: '2024-06-01T00:00:00.000Z' })

    await request(app)
      .post(`${API}/transactions/${sellId}/swap-link`)
      .set(...bearer(user))
      .send({ counterpartId: buyId })
      .expect(201)

    // DTO: both sides show the swap link with the counterpart asset
    const txs = (await request(app).get(`${API}/transactions`).set(...bearer(user))).body.transactions as Array<{
      id: string
      swapLink: { direction: string; counterpartAssetSymbol: string } | null
    }>
    expect(txs.find((t) => t.id === sellId)?.swapLink).toMatchObject({ direction: 'OUT', counterpartAssetSymbol: 'ETH' })
    expect(txs.find((t) => t.id === buyId)?.swapLink).toMatchObject({ direction: 'IN', counterpartAssetSymbol: 'BTC' })

    // AT: no gain from the swap, SWAP_DEFERRED notice
    const at = (await request(app).get(`${API}/tax/report?year=2024&country=AT`).set(...bearer(user))).body
    expect(at.warnings.map((w: { code: string }) => w.code)).toContain('SWAP_DEFERRED')
    expect((at.disposals as Array<{ assetSymbol: string }>).some((d) => d.assetSymbol === 'BTC')).toBe(false)
  })

  it('Validierung: zwei BUYs → 400, gleiches Asset → 400', async () => {
    const user = await registerUser('swap-val')
    const btc = await findAssetId(user, 'BTC')
    const eth = await findAssetId(user, 'ETH')

    const buy1 = await createTx(user, { assetId: btc, type: 'BUY', quantity: '1', pricePerUnit: '1', currency: 'EUR', timestamp: '2024-01-01T00:00:00.000Z' })
    const buy2 = await createTx(user, { assetId: eth, type: 'BUY', quantity: '1', pricePerUnit: '1', currency: 'EUR', timestamp: '2024-01-01T00:00:00.000Z' })
    const typeRes = await request(app).post(`${API}/transactions/${buy1}/swap-link`).set(...bearer(user)).send({ counterpartId: buy2 })
    expect(typeRes.status).toBe(400)
    expect(typeRes.body.error.code).toBe('SWAP_LINK_TYPES_INVALID')

    const sellBtc = await createTx(user, { assetId: btc, type: 'SELL', quantity: '1', pricePerUnit: '1', currency: 'EUR', timestamp: '2024-02-01T00:00:00.000Z' })
    const buyBtc = await createTx(user, { assetId: btc, type: 'BUY', quantity: '1', pricePerUnit: '1', currency: 'EUR', timestamp: '2024-02-01T00:00:00.000Z' })
    const sameRes = await request(app).post(`${API}/transactions/${sellBtc}/swap-link`).set(...bearer(user)).send({ counterpartId: buyBtc })
    expect(sameRes.status).toBe(400)
    expect(sameRes.body.error.code).toBe('SWAP_LINK_SAME_ASSET')
  })
})
