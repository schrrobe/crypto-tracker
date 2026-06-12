import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { prisma } from '../lib/prisma'
import { API, app, bearer, createManualSource, registerUser, uploadCsv, type TestUser } from './helpers'

async function findAssetId(user: TestUser, symbol: string): Promise<string> {
  const res = await request(app)
    .get(`${API}/assets/search?q=${symbol}`)
    .set(...bearer(user))
  const asset = (res.body.assets as Array<{ id: string; symbol: string }>).find((a) => a.symbol === symbol)
  if (!asset) throw new Error(`Asset ${symbol} nicht im Seed`)
  return asset.id
}

async function createTx(user: TestUser, body: Record<string, unknown>, expectStatus = 201) {
  const res = await request(app)
    .post(`${API}/transactions`)
    .set(...bearer(user))
    .send(body)
  expect(res.status).toBe(expectStatus)
  return res.body.transaction as { id: string; sourceId: string; editable: boolean }
}

describe('Manuelle Transaktionen', () => {
  it('CRUD: legt automatisch eine Quelle an und leitet Netto-Bestände ab', async () => {
    const user = await registerUser('manualtx')
    const btcId = await findAssetId(user, 'BTC')

    const buy = await createTx(user, {
      assetId: btcId,
      type: 'BUY',
      quantity: '2',
      pricePerUnit: '20000',
      feeAmount: '10',
      currency: 'EUR',
      timestamp: '2024-01-15T10:00:00.000Z',
    })
    expect(buy.editable).toBe(true)

    const sell = await createTx(user, {
      assetId: btcId,
      type: 'SELL',
      quantity: '0,5',
      pricePerUnit: '30000',
      currency: 'EUR',
      timestamp: '2024-06-15T10:00:00.000Z',
    })
    // beide Transaktionen landen in derselben automatisch verwalteten Quelle
    expect(sell.sourceId).toBe(buy.sourceId)

    const holdings = await prisma.holding.findMany({ where: { sourceId: buy.sourceId } })
    expect(holdings).toHaveLength(1)
    expect(holdings[0]?.quantity.toString()).toBe('1.5')

    // Update: Menge ändern → Bestand folgt
    const patch = await request(app)
      .patch(`${API}/transactions/${sell.id}`)
      .set(...bearer(user))
      .send({ quantity: '1' })
    expect(patch.status).toBe(200)
    const afterPatch = await prisma.holding.findMany({ where: { sourceId: buy.sourceId } })
    expect(afterPatch[0]?.quantity.toString()).toBe('1')

    // Delete: SELL weg → voller Kaufbestand
    const del = await request(app)
      .delete(`${API}/transactions/${sell.id}`)
      .set(...bearer(user))
    expect(del.status).toBe(204)
    const afterDelete = await prisma.holding.findMany({ where: { sourceId: buy.sourceId } })
    expect(afterDelete[0]?.quantity.toString()).toBe('2')
  })

  it('Netto-Saldo ≤ 0 ergibt keinen Bestand', async () => {
    const user = await registerUser('manualtx-net')
    const ethId = await findAssetId(user, 'ETH')

    const buy = await createTx(user, {
      assetId: ethId,
      type: 'BUY',
      quantity: '1',
      timestamp: '2024-01-01T00:00:00.000Z',
    })
    await createTx(user, {
      assetId: ethId,
      type: 'SELL',
      quantity: '1',
      timestamp: '2024-02-01T00:00:00.000Z',
    })
    const holdings = await prisma.holding.findMany({ where: { sourceId: buy.sourceId } })
    expect(holdings).toHaveLength(0)
  })

  it('GET /transactions listet auch importierte Transaktionen, aber editable=false', async () => {
    const user = await registerUser('manualtx-list')
    const csv = 'Datum;Typ;Coin;Menge\n2024-03-01;Kauf;BTC;1'
    const upload = await uploadCsv(user, csv, 'TRANSACTIONS')
    const mapping = await request(app)
      .post(`${API}/imports/${upload.import.id}/mapping`)
      .set(...bearer(user))
      .send({ mapping: { symbol: 'Coin', quantity: 'Menge', type: 'Typ', timestamp: 'Datum' } })
    expect(mapping.status).toBe(200)

    const res = await request(app)
      .get(`${API}/transactions`)
      .set(...bearer(user))
    expect(res.status).toBe(200)
    expect(res.body.transactions).toHaveLength(1)
    expect(res.body.transactions[0].editable).toBe(false)

    // importierte Transaktion ist nicht änderbar → 404
    const patch = await request(app)
      .patch(`${API}/transactions/${res.body.transactions[0].id}`)
      .set(...bearer(user))
      .send({ quantity: '2' })
    expect(patch.status).toBe(404)
  })

  it('sourceId-Filter begrenzt auf eine Quelle, fremde sourceId liefert leer', async () => {
    const user = await registerUser('manualtx-source')
    const stranger = await registerUser('manualtx-source-fremd')
    const btcId = await findAssetId(user, 'BTC')

    // manuelle Quelle + CSV-Quelle mit je einer Transaktion
    const manual = await createTx(user, { assetId: btcId, type: 'BUY', quantity: '1', timestamp: '2024-01-01T00:00:00.000Z' })
    const csv = 'Datum;Typ;Coin;Menge\n2024-03-01;Kauf;ETH;2'
    const upload = await uploadCsv(user, csv, 'TRANSACTIONS')
    await request(app)
      .post(`${API}/imports/${upload.import.id}/mapping`)
      .set(...bearer(user))
      .send({ mapping: { symbol: 'Coin', quantity: 'Menge', type: 'Typ', timestamp: 'Datum' } })

    const filtered = await request(app)
      .get(`${API}/transactions?sourceId=${upload.import.sourceId}`)
      .set(...bearer(user))
    expect(filtered.body.transactions).toHaveLength(1)
    expect(filtered.body.transactions[0].asset.symbol).toBe('ETH')

    const all = await request(app)
      .get(`${API}/transactions`)
      .set(...bearer(user))
    expect(all.body.transactions).toHaveLength(2)

    // fremder User mit derselben sourceId sieht nichts
    const foreign = await request(app)
      .get(`${API}/transactions?sourceId=${manual.sourceId}`)
      .set(...bearer(stranger))
    expect(foreign.body.transactions).toHaveLength(0)
  })

  it('Jahres-Filter begrenzt die Liste', async () => {
    const user = await registerUser('manualtx-year')
    const btcId = await findAssetId(user, 'BTC')
    await createTx(user, { assetId: btcId, type: 'BUY', quantity: '1', timestamp: '2023-12-31T23:59:59.000Z' })
    await createTx(user, { assetId: btcId, type: 'BUY', quantity: '1', timestamp: '2024-01-01T00:00:00.000Z' })

    const res = await request(app)
      .get(`${API}/transactions?year=2024`)
      .set(...bearer(user))
    expect(res.body.transactions).toHaveLength(1)
  })

  it('fremde Transaktionen sind unsichtbar (404)', async () => {
    const owner = await registerUser('manualtx-owner')
    const stranger = await registerUser('manualtx-stranger')
    const btcId = await findAssetId(owner, 'BTC')
    const tx = await createTx(owner, { assetId: btcId, type: 'BUY', quantity: '1', timestamp: '2024-01-01T00:00:00.000Z' })

    const patch = await request(app)
      .patch(`${API}/transactions/${tx.id}`)
      .set(...bearer(stranger))
      .send({ quantity: '2' })
    expect(patch.status).toBe(404)

    const del = await request(app)
      .delete(`${API}/transactions/${tx.id}`)
      .set(...bearer(stranger))
    expect(del.status).toBe(404)

    const list = await request(app)
      .get(`${API}/transactions`)
      .set(...bearer(stranger))
    expect(list.body.transactions).toHaveLength(0)
  })

  it('direkte Holding-Edits auf Transaktions-Quellen sind blockiert (409)', async () => {
    const user = await registerUser('manualtx-guard')
    const btcId = await findAssetId(user, 'BTC')
    const tx = await createTx(user, { assetId: btcId, type: 'BUY', quantity: '1', timestamp: '2024-01-01T00:00:00.000Z' })

    const res = await request(app)
      .post(`${API}/sources/${tx.sourceId}/holdings`)
      .set(...bearer(user))
      .send({ assetId: btcId, quantity: '5' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('SOURCE_HAS_TRANSACTIONS')

    // reine Manual-Quelle ohne Transaktionen bleibt direkt editierbar
    const plain = await createManualSource(user, 'Klassisch manuell')
    const ok = await request(app)
      .post(`${API}/sources/${plain.id}/holdings`)
      .set(...bearer(user))
      .send({ assetId: btcId, quantity: '5' })
    expect(ok.status).toBe(201)
  })

  it('Validierung: Zukunfts-Timestamp und ungültige Menge werden abgelehnt', async () => {
    const user = await registerUser('manualtx-val')
    const btcId = await findAssetId(user, 'BTC')

    const future = await request(app)
      .post(`${API}/transactions`)
      .set(...bearer(user))
      .send({ assetId: btcId, type: 'BUY', quantity: '1', timestamp: '2999-01-01T00:00:00.000Z' })
    expect(future.status).toBe(400)

    const zero = await request(app)
      .post(`${API}/transactions`)
      .set(...bearer(user))
      .send({ assetId: btcId, type: 'BUY', quantity: '0', timestamp: '2024-01-01T00:00:00.000Z' })
    expect(zero.status).toBe(400)
  })
})
