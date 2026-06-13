import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { API, app, bearer, createPortfolio, registerUser, uploadCsv, type TestUser } from './helpers'

async function findAssetId(user: TestUser, symbol: string): Promise<string> {
  const res = await request(app).get(`${API}/assets/search?q=${symbol}`).set(...bearer(user))
  const asset = (res.body.assets as Array<{ id: string; symbol: string }>).find((a) => a.symbol === symbol)
  if (!asset) throw new Error(`Asset ${symbol} nicht im Seed`)
  return asset.id
}

describe('Portfolio-Isolation (Integration)', () => {
  it('Quellen, Bestände, Transaktionen, Summary und Steuerreport sind strikt getrennt', async () => {
    const user = await registerUser('iso')
    const eltern = await createPortfolio(user, 'Eltern')
    const btcId = await findAssetId(user, 'BTC')

    // Default: Exchange-Quelle (Fake) + Sync → 0.1 BTC + 2 ETH
    const exchange = await request(app)
      .post(`${API}/sources`)
      .set(...bearer(user))
      .send({ type: 'EXCHANGE', provider: 'KRAKEN', label: 'Mein Kraken', apiKey: 'valid-key-1234', apiSecret: 'valid-secret' })
    expect(exchange.status).toBe(201)
    await request(app).post(`${API}/sources/${exchange.body.source.id}/sync`).set(...bearer(user))

    // Eltern: manuelle Transaktionen (BUY 2023, SELL 2024 → Gewinn)
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

    // Quellen getrennt
    const defaultSources = await request(app).get(`${API}/sources`).set(...bearer(user))
    expect(defaultSources.body.sources).toHaveLength(1)
    expect(defaultSources.body.sources[0].label).toBe('Mein Kraken')
    const elternSources = await request(app)
      .get(`${API}/sources?portfolioId=${eltern.id}`)
      .set(...bearer(user))
    expect(elternSources.body.sources).toHaveLength(1)
    expect(elternSources.body.sources[0].type).toBe('MANUAL')

    // Transaktionen getrennt
    const defaultTxs = await request(app).get(`${API}/transactions`).set(...bearer(user))
    expect(defaultTxs.body.transactions).toHaveLength(0)
    const elternTxs = await request(app)
      .get(`${API}/transactions?portfolioId=${eltern.id}`)
      .set(...bearer(user))
    expect(elternTxs.body.transactions).toHaveLength(2)

    // Summary getrennt: Default hat Exchange-Bestände, Eltern hat 0 BTC (Netto 0)
    const defaultSummary = await request(app).get(`${API}/portfolio/summary`).set(...bearer(user))
    expect(Number(defaultSummary.body.totalEur)).toBeGreaterThan(0)
    const elternSummary = await request(app)
      .get(`${API}/portfolio/summary?portfolioId=${eltern.id}`)
      .set(...bearer(user))
    expect(elternSummary.body.totalEur).toBe('0.00')

    // Steuerreport getrennt: Eltern haben den Gewinn, Default nicht
    const elternReport = await request(app)
      .get(`${API}/tax/report?year=2024&country=DE&portfolioId=${eltern.id}`)
      .set(...bearer(user))
    expect(elternReport.body.disposals).toHaveLength(1)
    // > 1 Jahr gehalten → steuerfrei, aber der Gewinn gehört den Eltern
    expect(elternReport.body.totals.totalGainEur).toBe('10000.00')
    expect(elternReport.body.totals.taxFreeGainEur).toBe('10000.00')
    const defaultReport = await request(app)
      .get(`${API}/tax/report?year=2024&country=DE`)
      .set(...bearer(user))
    expect(defaultReport.body.disposals).toHaveLength(0)
    // Exchange-Quelle des Defaults bleibt dort als uncovered gelistet
    expect(defaultReport.body.uncoveredSources).toHaveLength(1)
    expect(elternReport.body.uncoveredSources).toHaveLength(0)
  })

  it('sync-all synct nur das angegebene Portfolio', async () => {
    const user = await registerUser('iso-sync')
    const eltern = await createPortfolio(user, 'Eltern')

    for (const [label, portfolioId] of [
      ['Default-Kraken', undefined],
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

    // Default-Quelle wurde nicht angefasst
    const defaultSources = await request(app).get(`${API}/sources`).set(...bearer(user))
    expect(defaultSources.body.sources[0].lastSyncAt).toBeNull()
  })

  it('zwei Portfolios bekommen getrennte automatische MANUAL-Quellen', async () => {
    const user = await registerUser('iso-manual')
    const eltern = await createPortfolio(user, 'Eltern')
    const btcId = await findAssetId(user, 'BTC')

    for (const portfolioId of [undefined, eltern.id]) {
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
    const btcId = await findAssetId(user, 'BTC')

    const w = await request(app)
      .post(`${API}/transactions`)
      .set(...bearer(user))
      .send({ assetId: btcId, type: 'WITHDRAWAL', quantity: '1', timestamp: '2024-01-10T00:00:00.000Z' })
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
