import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { API, app, bearer, createPortfolio, registerUser, type TestUser } from './helpers'

async function findAssetId(user: TestUser, symbol: string): Promise<string> {
  const res = await request(app).get(`${API}/assets/search?q=${symbol}`).set(...bearer(user))
  const asset = (res.body.assets as Array<{ id: string; symbol: string }>).find((a) => a.symbol === symbol)
  if (!asset) throw new Error(`Asset ${symbol} nicht im Seed`)
  return asset.id
}

// With >1 portfolio, writes must name their entity explicitly (PORTFOLIO_REQUIRED).
async function defaultPortfolioId(user: TestUser): Promise<string> {
  const res = await request(app).get(`${API}/portfolios`).set(...bearer(user))
  const def = (res.body.portfolios as Array<{ id: string; isDefault: boolean }>).find((p) => p.isDefault)
  if (!def) throw new Error('Kein Default-Portfolio gefunden')
  return def.id
}

describe('Portfolio-Isolation (Integration)', () => {
  it('Quellen, Bestände, Transaktionen, Summary und Steuerreport sind strikt getrennt', async () => {
    const user = await registerUser('iso')
    const btcId = await findAssetId(user, 'BTC')

    // Default: exchange source (fake) + sync → 0.1 BTC + 2 ETH (created while the
    // default is still the only entity, so an omitted portfolioId is unambiguous)
    const exchange = await request(app)
      .post(`${API}/sources`)
      .set(...bearer(user))
      .send({ type: 'EXCHANGE', provider: 'KRAKEN', label: 'Mein Kraken', apiKey: 'valid-key-1234', apiSecret: 'valid-secret' })
    expect(exchange.status).toBe(201)
    await request(app).post(`${API}/sources/${exchange.body.source.id}/sync`).set(...bearer(user))

    const eltern = await createPortfolio(user, 'Eltern')

    // Eltern: manual transactions (BUY 2023, SELL 2024 → gain)
    for (const tx of [
      { type: 'BUY', quantity: '1', pricePerUnit: '20000', timestamp: '2023-01-15T10:00:00.000Z' },
      { type: 'SELL', quantity: '1', pricePerUnit: '30000', timestamp: '2024-06-15T10:00:00.000Z' },
    ]) {
      const res = await request(app)
        .post(`${API}/transactions`)
        .set(...bearer(user))
        .send({ assetId: btcId, currency: 'EUR', portfolioId: eltern.id, ...tx })
      expect(res.status).toBe(201)
    }

    // sources separated
    const defaultSources = await request(app).get(`${API}/sources`).set(...bearer(user))
    expect(defaultSources.body.sources).toHaveLength(1)
    expect(defaultSources.body.sources[0].label).toBe('Mein Kraken')
    const elternSources = await request(app)
      .get(`${API}/sources?portfolioId=${eltern.id}`)
      .set(...bearer(user))
    expect(elternSources.body.sources).toHaveLength(1)
    expect(elternSources.body.sources[0].type).toBe('MANUAL')

    // transactions separated
    const defaultTxs = await request(app).get(`${API}/transactions`).set(...bearer(user))
    expect(defaultTxs.body.transactions).toHaveLength(0)
    const elternTxs = await request(app)
      .get(`${API}/transactions?portfolioId=${eltern.id}`)
      .set(...bearer(user))
    expect(elternTxs.body.transactions).toHaveLength(2)

    // summary separated: Default has exchange holdings, Eltern has 0 BTC (net 0)
    const defaultSummary = await request(app).get(`${API}/portfolio/summary`).set(...bearer(user))
    expect(Number(defaultSummary.body.totalEur)).toBeGreaterThan(0)
    const elternSummary = await request(app)
      .get(`${API}/portfolio/summary?portfolioId=${eltern.id}`)
      .set(...bearer(user))
    expect(elternSummary.body.totalEur).toBe('0.00')

    // tax report separated: Eltern has the gain, Default does not
    const elternReport = await request(app)
      .get(`${API}/tax/report?year=2024&country=DE&portfolioId=${eltern.id}`)
      .set(...bearer(user))
    expect(elternReport.body.disposals).toHaveLength(1)
    // > 1 year held → tax-free, but the gain belongs to Eltern
    expect(elternReport.body.totals.totalGainEur).toBe('10000.00')
    expect(elternReport.body.totals.taxFreeGainEur).toBe('10000.00')
    const defaultReport = await request(app)
      .get(`${API}/tax/report?year=2024&country=DE`)
      .set(...bearer(user))
    expect(defaultReport.body.disposals).toHaveLength(0)
    // the Default's exchange source remains listed there as uncovered
    expect(defaultReport.body.uncoveredSources).toHaveLength(1)
    expect(elternReport.body.uncoveredSources).toHaveLength(0)
  })

  it('sync-all synct nur das angegebene Portfolio', async () => {
    const user = await registerUser('iso-sync')
    const eltern = await createPortfolio(user, 'Eltern')
    const defId = await defaultPortfolioId(user)

    for (const [label, portfolioId] of [
      ['Default-Kraken', defId],
      ['Eltern-Kraken', eltern.id],
    ] as const) {
      const res = await request(app)
        .post(`${API}/sources`)
        .set(...bearer(user))
        .send({ type: 'EXCHANGE', provider: 'KRAKEN', label, apiKey: 'valid-key-1234', apiSecret: 'valid-secret', portfolioId })
      expect(res.status).toBe(201)
    }

    const syncAll = await request(app)
      .post(`${API}/sources/sync-all`)
      .set(...bearer(user))
      .send({ portfolioId: eltern.id })
    expect(syncAll.body.results).toHaveLength(1)

    // Default source was not touched
    const defaultSources = await request(app).get(`${API}/sources`).set(...bearer(user))
    expect(defaultSources.body.sources[0].lastSyncAt).toBeNull()
  })

  it('zwei Portfolios bekommen getrennte automatische MANUAL-Quellen', async () => {
    const user = await registerUser('iso-manual')
    const eltern = await createPortfolio(user, 'Eltern')
    const defId = await defaultPortfolioId(user)
    const btcId = await findAssetId(user, 'BTC')

    for (const portfolioId of [defId, eltern.id]) {
      const res = await request(app)
        .post(`${API}/transactions`)
        .set(...bearer(user))
        .send({ assetId: btcId, type: 'BUY', quantity: '1', timestamp: '2024-01-01T00:00:00.000Z', portfolioId })
      expect(res.status).toBe(201)
    }
    const all = await request(app).get(`${API}/transactions`).set(...bearer(user))
    const elternList = await request(app)
      .get(`${API}/transactions?portfolioId=${eltern.id}`)
      .set(...bearer(user))
    expect(all.body.transactions).toHaveLength(1)
    expect(elternList.body.transactions).toHaveLength(1)
    expect(all.body.transactions[0].sourceId).not.toBe(elternList.body.transactions[0].sourceId)
  })

  it('Transfer-Link über Portfolio-Grenze wird abgelehnt', async () => {
    const user = await registerUser('iso-link')
    const eltern = await createPortfolio(user, 'Eltern')
    const defId = await defaultPortfolioId(user)
    const btcId = await findAssetId(user, 'BTC')

    const w = await request(app)
      .post(`${API}/transactions`)
      .set(...bearer(user))
      .send({ assetId: btcId, type: 'WITHDRAWAL', quantity: '1', timestamp: '2024-01-10T00:00:00.000Z', portfolioId: defId })
    const d = await request(app)
      .post(`${API}/transactions`)
      .set(...bearer(user))
      .send({ assetId: btcId, type: 'DEPOSIT', quantity: '1', timestamp: '2024-01-10T01:00:00.000Z', portfolioId: eltern.id })

    const link = await request(app)
      .post(`${API}/transactions/${w.body.transaction.id}/transfer-link`)
      .set(...bearer(user))
      .send({ counterpartId: d.body.transaction.id })
    expect(link.status).toBe(400)
    expect(link.body.error.code).toBe('TRANSFER_LINK_PORTFOLIO_MISMATCH')
  })
})
