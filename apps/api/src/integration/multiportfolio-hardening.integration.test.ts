import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { API, app, bearer, createManualSource, createPortfolio, registerUser, type TestUser } from './helpers'

async function findAssetId(user: TestUser, symbol: string): Promise<string> {
  const res = await request(app).get(`${API}/assets/search?q=${symbol}`).set(...bearer(user))
  const asset = (res.body.assets as Array<{ id: string; symbol: string }>).find((a) => a.symbol === symbol)
  if (!asset) throw new Error(`Asset ${symbol} nicht im Seed`)
  return asset.id
}

function manualSourceCount(sources: Array<{ type: string }>): number {
  return sources.filter((s) => s.type === 'MANUAL').length
}

describe('Multi-Portfolio-Härtung (Integration)', () => {
  // P1-1: concurrent first transactions must not create two auto MANUAL buckets
  it('nebenläufige erste Transaktionen erzeugen genau eine MANUAL-Quelle', async () => {
    const user = await registerUser('hard-race')
    const btcId = await findAssetId(user, 'BTC')

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        request(app)
          .post(`${API}/transactions`)
          .set(...bearer(user))
          .send({
            assetId: btcId,
            type: 'BUY',
            quantity: '1',
            timestamp: `2024-01-0${i + 1}T00:00:00.000Z`,
          }),
      ),
    )
    expect(results.every((r) => r.status === 201)).toBe(true)

    const sources = await request(app).get(`${API}/sources`).set(...bearer(user))
    expect(manualSourceCount(sources.body.sources)).toBe(1)
  })

  // P2-4: deleting the last manual transaction drops the empty auto bucket so the
  // portfolio stays deletable and the phantom source disappears
  it('löschen der letzten manuellen Transaktion entfernt den leeren Auto-Bucket', async () => {
    const user = await registerUser('hard-empty')
    const eltern = await createPortfolio(user, 'Eltern')
    const btcId = await findAssetId(user, 'BTC')

    const created = await request(app)
      .post(`${API}/transactions`)
      .set(...bearer(user))
      .send({ assetId: btcId, type: 'BUY', quantity: '1', timestamp: '2024-01-01T00:00:00.000Z', portfolioId: eltern.id })
    expect(created.status).toBe(201)

    // bucket now exists → portfolio not empty → deletion blocked
    const blocked = await request(app).delete(`${API}/portfolios/${eltern.id}`).set(...bearer(user))
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.code).toBe('PORTFOLIO_NOT_EMPTY')

    await request(app)
      .delete(`${API}/transactions/${created.body.transaction.id}`)
      .set(...bearer(user))

    // bucket gone → no MANUAL source left in the portfolio
    const sources = await request(app)
      .get(`${API}/sources?portfolioId=${eltern.id}`)
      .set(...bearer(user))
    expect(manualSourceCount(sources.body.sources)).toBe(0)

    // and the now-empty portfolio is deletable
    const deleted = await request(app).delete(`${API}/portfolios/${eltern.id}`).set(...bearer(user))
    expect(deleted.status).toBe(204)
  })

  // P2-3: the reserved auto-bucket label cannot be claimed by a user source
  it('reservierter Label „Manuelle Transaktionen" wird bei createSource abgelehnt', async () => {
    const user = await registerUser('hard-reserved')
    const res = await request(app)
      .post(`${API}/sources`)
      .set(...bearer(user))
      .send({ type: 'MANUAL', label: 'Manuelle Transaktionen' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('SOURCE_LABEL_RESERVED')
  })

  // P2-3: the auto bucket does not count against the free source limit
  it('Auto-Bucket zählt nicht gegen das Free-Quellen-Limit', async () => {
    const user = await registerUser('hard-limit', 'FREE')
    const btcId = await findAssetId(user, 'BTC')

    // create the auto bucket via a manual transaction
    const tx = await request(app)
      .post(`${API}/transactions`)
      .set(...bearer(user))
      .send({ assetId: btcId, type: 'BUY', quantity: '1', timestamp: '2024-01-01T00:00:00.000Z' })
    expect(tx.status).toBe(201)

    // 5 user-created sources still fit despite the auto bucket existing
    for (let i = 0; i < 5; i++) {
      await createManualSource(user, `Bucket ${i}`)
    }
    // the 6th exceeds the limit
    const overflow = await request(app)
      .post(`${API}/sources`)
      .set(...bearer(user))
      .send({ type: 'MANUAL', label: 'Bucket 6' })
    expect(overflow.status).toBe(402)
  })

  // P2-5: body portfolioId is validated as a uuid
  it('ungültige body portfolioId wird abgelehnt (sync-all & prices/refresh)', async () => {
    const user = await registerUser('hard-uuid')

    const syncAll = await request(app)
      .post(`${API}/sources/sync-all`)
      .set(...bearer(user))
      .send({ portfolioId: 'not-a-uuid' })
    expect(syncAll.status).toBe(400)
    expect(syncAll.body.error.code).toBe('VALIDATION_ERROR')

    const refresh = await request(app)
      .post(`${API}/prices/refresh`)
      .set(...bearer(user))
      .send({ portfolioId: 'not-a-uuid' })
    expect(refresh.status).toBe(400)
    expect(refresh.body.error.code).toBe('VALIDATION_ERROR')
  })

  // P0: with >1 tax entity, a write without portfolioId must not silently default
  it('write ohne portfolioId wird bei mehreren Steuersubjekten abgelehnt', async () => {
    const user = await registerUser('p0-required')
    const btcId = await findAssetId(user, 'BTC')

    // single portfolio → omitted portfolioId is unambiguous, defaults
    const single = await request(app)
      .post(`${API}/transactions`)
      .set(...bearer(user))
      .send({ assetId: btcId, type: 'BUY', quantity: '1', timestamp: '2024-01-01T00:00:00.000Z' })
    expect(single.status).toBe(201)

    const eltern = await createPortfolio(user, 'Eltern')

    // now two entities → omitted portfolioId is rejected, not guessed
    const ambiguous = await request(app)
      .post(`${API}/transactions`)
      .set(...bearer(user))
      .send({ assetId: btcId, type: 'BUY', quantity: '1', timestamp: '2024-02-01T00:00:00.000Z' })
    expect(ambiguous.status).toBe(400)
    expect(ambiguous.body.error.code).toBe('PORTFOLIO_REQUIRED')

    // explicit id → accepted
    const explicit = await request(app)
      .post(`${API}/transactions`)
      .set(...bearer(user))
      .send({
        assetId: btcId,
        type: 'BUY',
        quantity: '1',
        timestamp: '2024-02-01T00:00:00.000Z',
        portfolioId: eltern.id,
      })
    expect(explicit.status).toBe(201)

    // createSource is guarded the same way
    const sourceAmbiguous = await request(app)
      .post(`${API}/sources`)
      .set(...bearer(user))
      .send({ type: 'MANUAL', label: 'Ambiguous bucket' })
    expect(sourceAmbiguous.status).toBe(400)
    expect(sourceAmbiguous.body.error.code).toBe('PORTFOLIO_REQUIRED')
  })

  // P0: tax entities must be tellable apart — labels are unique per user
  it('doppelter Portfolio-Name wird abgelehnt', async () => {
    const user = await registerUser('p0-dupe')
    await createPortfolio(user, 'Firma')
    const dupe = await request(app)
      .post(`${API}/portfolios`)
      .set(...bearer(user))
      .send({ label: '  firma ' }) // case + whitespace insensitive
    expect(dupe.status).toBe(409)
    expect(dupe.body.error.code).toBe('PORTFOLIO_LABEL_DUPLICATE')
  })

  // P0: the tax report is stamped with the entity it covers
  it('Steuerreport trägt den Namen des Steuersubjekts', async () => {
    const user = await registerUser('p0-stamp')
    const eltern = await createPortfolio(user, 'Eltern')
    const report = await request(app)
      .get(`${API}/tax/report?year=2024&country=DE&portfolioId=${eltern.id}`)
      .set(...bearer(user))
    expect(report.status).toBe(200)
    expect(report.body.portfolioLabel).toBe('Eltern')
  })
})
