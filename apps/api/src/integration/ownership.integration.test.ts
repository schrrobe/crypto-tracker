import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  API,
  app,
  bearer,
  createExchangeSource,
  createManualSource,
  registerUser,
  uploadCsv,
  type TestUser,
} from './helpers'

// Tenant-Isolation: User B darf Ressourcen von User A weder sehen noch verändern.
// Erwartung ist überall 404 (nicht 403) — die Existenz fremder IDs wird nicht verraten.

describe('Tenant-Isolation (Integration)', () => {
  let alice: TestUser
  let bob: TestUser
  let aliceManualId: string
  let aliceExchangeId: string
  let aliceHoldingId: string
  let aliceImportId: string

  beforeAll(async () => {
    alice = await registerUser('alice')
    bob = await registerUser('bob')

    aliceManualId = (await createManualSource(alice, 'Alice Manuell')).id
    aliceExchangeId = (await createExchangeSource(alice, 'Alice Exchange')).id

    // Manueller BTC-Bestand für Alice
    const assets = await request(app).get(`${API}/assets/search?q=bitcoin`).set(...bearer(alice))
    const btcId = assets.body.assets[0].id as string
    const holding = await request(app)
      .post(`${API}/sources/${aliceManualId}/holdings`)
      .set(...bearer(alice))
      .send({ assetId: btcId, quantity: '0.5' })
    aliceHoldingId = holding.body.holding.id

    aliceImportId = (await uploadCsv(alice, 'Coin,Amount\nBTC,1\n', 'BALANCES')).import.id
  })

  it('Quellen: Liste leakt nichts, Zugriff/Änderung/Löschung fremder Quellen → 404', async () => {
    const list = await request(app).get(`${API}/sources`).set(...bearer(bob))
    expect(list.body.sources).toHaveLength(0)

    for (const sourceId of [aliceManualId, aliceExchangeId]) {
      await request(app)
        .patch(`${API}/sources/${sourceId}`)
        .set(...bearer(bob))
        .send({ label: 'gekapert' })
        .expect(404)
      await request(app).delete(`${API}/sources/${sourceId}`).set(...bearer(bob)).expect(404)
    }
  })

  it('Holdings: kein Anlegen/Ändern/Löschen in fremden Quellen', async () => {
    const assets = await request(app).get(`${API}/assets/search?q=bitcoin`).set(...bearer(bob))
    const btcId = assets.body.assets[0].id as string

    await request(app)
      .post(`${API}/sources/${aliceManualId}/holdings`)
      .set(...bearer(bob))
      .send({ assetId: btcId, quantity: '99' })
      .expect(404)
    await request(app)
      .patch(`${API}/sources/${aliceManualId}/holdings/${aliceHoldingId}`)
      .set(...bearer(bob))
      .send({ quantity: '99' })
      .expect(404)
    await request(app)
      .delete(`${API}/sources/${aliceManualId}/holdings/${aliceHoldingId}`)
      .set(...bearer(bob))
      .expect(404)

    // Alices Bestand ist unverändert
    const aliceHoldings = await request(app).get(`${API}/holdings`).set(...bearer(alice))
    const btc = aliceHoldings.body.holdings.find(
      (h: { id: string }) => h.id === aliceHoldingId,
    )
    expect(btc.quantity).toBe('0.5')
  })

  it('Sync: fremde Quellen können nicht synchronisiert oder eingesehen werden', async () => {
    await request(app).post(`${API}/sources/${aliceExchangeId}/sync`).set(...bearer(bob)).expect(404)
    await request(app).get(`${API}/sources/${aliceExchangeId}/sync-runs`).set(...bearer(bob)).expect(404)
    // sync-all von Bob fasst Alices Quellen nicht an
    const res = await request(app).post(`${API}/sources/sync-all`).set(...bearer(bob))
    expect(res.body.results).toHaveLength(0)
  })

  it('Imports: fremde Importe sind unsichtbar und unlöschbar', async () => {
    const list = await request(app).get(`${API}/imports`).set(...bearer(bob))
    expect(list.body.imports).toHaveLength(0)
    await request(app).delete(`${API}/imports/${aliceImportId}`).set(...bearer(bob)).expect(404)
    await request(app)
      .post(`${API}/imports/${aliceImportId}/mapping`)
      .set(...bearer(bob))
      .send({ mapping: { symbol: 'Coin', quantity: 'Amount' } })
      .expect(404)
  })

  it('Portfolio: Bobs Summary und Holdings enthalten nichts von Alice', async () => {
    const summary = await request(app).get(`${API}/portfolio/summary`).set(...bearer(bob))
    expect(summary.body.totalEur).toBe('0.00')
    expect(summary.body.byAsset).toHaveLength(0)
    const holdings = await request(app).get(`${API}/holdings`).set(...bearer(bob))
    expect(holdings.body.holdings).toHaveLength(0)
  })
})
