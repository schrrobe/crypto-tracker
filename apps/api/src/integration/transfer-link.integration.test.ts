import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { API, app, bearer, registerUser, uploadCsv, type TestUser } from './helpers'

async function findAssetId(user: TestUser, symbol: string): Promise<string> {
  const res = await request(app)
    .get(`${API}/assets/search?q=${symbol}`)
    .set(...bearer(user))
  const asset = (res.body.assets as Array<{ id: string; symbol: string }>).find((a) => a.symbol === symbol)
  if (!asset) throw new Error(`Asset ${symbol} nicht im Seed`)
  return asset.id
}

async function createTx(user: TestUser, body: Record<string, unknown>) {
  const res = await request(app)
    .post(`${API}/transactions`)
    .set(...bearer(user))
    .send(body)
  expect(res.status).toBe(201)
  return res.body.transaction as { id: string; sourceId: string }
}

// CSV source with BUY + WITHDRAWAL (source A of the transfer)
async function createCsvWithdrawalSource(user: TestUser) {
  const csv =
    'Datum;Typ;Coin;Menge;Kurs\n' +
    '2020-05-01;Kauf;BTC;1;1000\n' +
    '2023-02-01;Auszahlung;BTC;1;'
  const upload = await uploadCsv(user, csv, 'TRANSACTIONS', 'Exchange A')
  const mapping = await request(app)
    .post(`${API}/imports/${upload.import.id}/mapping`)
    .set(...bearer(user))
    .send({ mapping: { symbol: 'Coin', quantity: 'Menge', type: 'Typ', timestamp: 'Datum', price: 'Kurs' } })
  expect(mapping.status).toBe(200)

  const list = await request(app)
    .get(`${API}/transactions`)
    .set(...bearer(user))
  const txs = list.body.transactions as Array<{ id: string; type: string; sourceId: string }>
  const withdrawal = txs.find((t) => t.type === 'WITHDRAWAL')
  if (!withdrawal) throw new Error('WITHDRAWAL fehlt nach Import')
  return { withdrawal, sourceId: withdrawal.sourceId }
}

function link(user: TestUser, txId: string, counterpartId: string) {
  return request(app)
    .post(`${API}/transactions/${txId}/transfer-link`)
    .set(...bearer(user))
    .send({ counterpartId })
}

describe('Transfer-Links (Integration)', () => {
  it('Happy-Path: verknüpfen, DTO-Richtung, Kostenbasis zieht im DE-Report um', async () => {
    const user = await registerUser('link-happy')
    const btcId = await findAssetId(user, 'BTC')
    const { withdrawal } = await createCsvWithdrawalSource(user)
    const deposit = await createTx(user, {
      assetId: btcId,
      type: 'DEPOSIT',
      quantity: '1',
      timestamp: '2023-02-01T06:00:00.000Z',
    })

    const res = await link(user, withdrawal.id, deposit.id)
    expect(res.status).toBe(201)

    const list = await request(app)
      .get(`${API}/transactions`)
      .set(...bearer(user))
    const txs = list.body.transactions as Array<{
      id: string
      transferLink: { direction: string; counterpartTxId: string; counterpartSourceLabel: string } | null
    }>
    const w = txs.find((t) => t.id === withdrawal.id)
    const d = txs.find((t) => t.id === deposit.id)
    expect(w?.transferLink?.direction).toBe('OUT')
    expect(w?.transferLink?.counterpartTxId).toBe(deposit.id)
    expect(d?.transferLink?.direction).toBe('IN')
    expect(d?.transferLink?.counterpartSourceLabel).toBe('Exchange A')

    // Sale from source B → cost basis 1000 from 2020 retained, > 1 year → tax-free
    await createTx(user, {
      assetId: btcId,
      type: 'SELL',
      quantity: '1',
      pricePerUnit: '30000',
      currency: 'EUR',
      timestamp: '2024-06-01T00:00:00.000Z',
    })
    const report = await request(app)
      .get(`${API}/tax/report?year=2024&country=DE`)
      .set(...bearer(user))
    expect(report.status).toBe(200)
    expect(report.body.disposals).toHaveLength(1)
    expect(report.body.disposals[0].costBasisEur).toBe('1000.00')
    expect(report.body.disposals[0].taxable).toBe(false)
    const codes = report.body.warnings.map((w2: { code: string }) => w2.code)
    expect(codes).not.toContain('WITHDRAWAL_REMOVED_LOTS')
    expect(codes).not.toContain('UNKNOWN_ACQUISITION_BASIS')
  })

  it('Validierungsmatrix: Typen, Asset, Menge, Timestamp, Doppel-Link', async () => {
    const user = await registerUser('link-val')
    const btcId = await findAssetId(user, 'BTC')
    const ethId = await findAssetId(user, 'ETH')

    const withdrawal = await createTx(user, {
      assetId: btcId,
      type: 'WITHDRAWAL',
      quantity: '1',
      timestamp: '2024-01-10T00:00:00.000Z',
    })
    const buy = await createTx(user, {
      assetId: btcId,
      type: 'BUY',
      quantity: '1',
      timestamp: '2024-01-10T00:00:00.000Z',
    })
    const ethDeposit = await createTx(user, {
      assetId: ethId,
      type: 'DEPOSIT',
      quantity: '1',
      timestamp: '2024-01-10T01:00:00.000Z',
    })
    const tooBig = await createTx(user, {
      assetId: btcId,
      type: 'DEPOSIT',
      quantity: '2',
      timestamp: '2024-01-10T01:00:00.000Z',
    })
    const tooEarly = await createTx(user, {
      assetId: btcId,
      type: 'DEPOSIT',
      quantity: '1',
      timestamp: '2024-01-05T00:00:00.000Z',
    })
    const ok = await createTx(user, {
      assetId: btcId,
      type: 'DEPOSIT',
      quantity: '1',
      timestamp: '2024-01-10T02:00:00.000Z',
    })

    expect((await link(user, withdrawal.id, buy.id)).body.error.code).toBe('TRANSFER_LINK_TYPES_INVALID')
    expect((await link(user, withdrawal.id, ethDeposit.id)).body.error.code).toBe('TRANSFER_LINK_ASSET_MISMATCH')
    expect((await link(user, withdrawal.id, tooBig.id)).body.error.code).toBe('TRANSFER_LINK_QUANTITY_INVALID')
    expect((await link(user, withdrawal.id, tooEarly.id)).body.error.code).toBe('TRANSFER_LINK_TIMESTAMP_INVALID')

    // valid link — also allowed from the deposit side
    expect((await link(user, ok.id, withdrawal.id)).status).toBe(201)
    const again = await createTx(user, {
      assetId: btcId,
      type: 'DEPOSIT',
      quantity: '1',
      timestamp: '2024-01-10T03:00:00.000Z',
    })
    const dup = await link(user, withdrawal.id, again.id)
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('TRANSFER_LINK_ALREADY_LINKED')
  })

  it('fremde Transaktionen → 404; Unlink funktioniert', async () => {
    const owner = await registerUser('link-owner')
    const stranger = await registerUser('link-stranger')
    const btcId = await findAssetId(owner, 'BTC')

    const w = await createTx(owner, {
      assetId: btcId,
      type: 'WITHDRAWAL',
      quantity: '1',
      timestamp: '2024-01-10T00:00:00.000Z',
    })
    const d = await createTx(owner, {
      assetId: btcId,
      type: 'DEPOSIT',
      quantity: '1',
      timestamp: '2024-01-10T01:00:00.000Z',
    })

    expect((await link(stranger, w.id, d.id)).status).toBe(404)
    expect((await link(owner, w.id, d.id)).status).toBe(201)

    const strangerUnlink = await request(app)
      .delete(`${API}/transactions/${w.id}/transfer-link`)
      .set(...bearer(stranger))
    expect(strangerUnlink.status).toBe(404)

    const unlink = await request(app)
      .delete(`${API}/transactions/${w.id}/transfer-link`)
      .set(...bearer(owner))
    expect(unlink.status).toBe(204)

    const list = await request(app)
      .get(`${API}/transactions`)
      .set(...bearer(owner))
    expect(list.body.transactions.every((t: { transferLink: unknown }) => t.transferLink === null)).toBe(true)
  })

  it('PATCH auf verlinkte manuelle Tx: Invarianten-Felder → 409, Kurs erlaubt', async () => {
    const user = await registerUser('link-patch')
    const btcId = await findAssetId(user, 'BTC')
    const w = await createTx(user, {
      assetId: btcId,
      type: 'WITHDRAWAL',
      quantity: '1',
      timestamp: '2024-01-10T00:00:00.000Z',
    })
    const d = await createTx(user, {
      assetId: btcId,
      type: 'DEPOSIT',
      quantity: '1',
      timestamp: '2024-01-10T01:00:00.000Z',
    })
    expect((await link(user, w.id, d.id)).status).toBe(201)

    const patchQty = await request(app)
      .patch(`${API}/transactions/${d.id}`)
      .set(...bearer(user))
      .send({ quantity: '0.5' })
    expect(patchQty.status).toBe(409)
    expect(patchQty.body.error.code).toBe('TRANSFER_LINKED_TX_IMMUTABLE')

    // price is not a link invariant
    const patchPrice = await request(app)
      .patch(`${API}/transactions/${d.id}`)
      .set(...bearer(user))
      .send({ pricePerUnit: '123' })
    expect(patchPrice.status).toBe(200)
  })

  it('Löschen einer Seite räumt den Link auf (Cascade), Gegenseite bleibt sauber', async () => {
    const user = await registerUser('link-cascade')
    const btcId = await findAssetId(user, 'BTC')
    const { withdrawal, sourceId } = await createCsvWithdrawalSource(user)
    const d = await createTx(user, {
      assetId: btcId,
      type: 'DEPOSIT',
      quantity: '1',
      timestamp: '2023-02-01T06:00:00.000Z',
    })
    expect((await link(user, withdrawal.id, d.id)).status).toBe(201)

    // delete CSV source → withdrawal + link disappear via cascade
    const del = await request(app)
      .delete(`${API}/sources/${sourceId}`)
      .set(...bearer(user))
    expect(del.status).toBe(204)

    const list = await request(app)
      .get(`${API}/transactions`)
      .set(...bearer(user))
    const remaining = list.body.transactions as Array<{ id: string; transferLink: unknown }>
    expect(remaining.find((t) => t.id === d.id)?.transferLink).toBeNull()
  })
})
