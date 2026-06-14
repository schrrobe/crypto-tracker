import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { API, app, bearer, createExchangeSource, registerUser } from './helpers'

// FAKE_PRICES: market_chart deterministically returns 90 % → 100 % of the current
// fake price; the last history point therefore matches the summary total value.

describe('Portfolio-Verlauf (Integration)', () => {
  it('liefert Buckets, deren letzter Punkt dem aktuellen Gesamtwert entspricht', async () => {
    const user = await registerUser('history')
    const source = await createExchangeSource(user, 'History Exchange')
    await request(app).post(`${API}/sources/${source.id}/sync`).set(...bearer(user)).expect(200)

    const history = await request(app)
      .get(`${API}/portfolio/history?range=24h&currency=EUR`)
      .set(...bearer(user))
    expect(history.status).toBe(200)
    expect(history.body.range).toBe('24h')
    expect(history.body.points).toHaveLength(25) // 24 buckets + endpoint

    const summary = await request(app).get(`${API}/portfolio/summary`).set(...bearer(user))
    const last = history.body.points.at(-1)
    expect(Number(last.value)).toBeCloseTo(Number(summary.body.totalEur), 0)

    // Fake history rises: first point ≈ 90 % of the last
    const first = history.body.points[0]
    expect(Number(first.value) / Number(last.value)).toBeCloseTo(0.9, 1)
  })

  it('USD-Verlauf nutzt USD-Preise', async () => {
    const user = await registerUser('historyusd')
    const source = await createExchangeSource(user, 'USD Exchange')
    await request(app).post(`${API}/sources/${source.id}/sync`).set(...bearer(user)).expect(200)

    const eur = await request(app)
      .get(`${API}/portfolio/history?range=7d&currency=EUR`)
      .set(...bearer(user))
    const usd = await request(app)
      .get(`${API}/portfolio/history?range=7d&currency=USD`)
      .set(...bearer(user))
    expect(usd.body.currency).toBe('USD')
    // Fake: BTC 50.000 EUR / 55.000 USD → USD history is higher
    expect(Number(usd.body.points.at(-1).value)).toBeGreaterThan(Number(eur.body.points.at(-1).value))
  })

  it('leeres Portfolio liefert leere Punkte, ungültige Range → 400', async () => {
    const user = await registerUser('historyempty')
    const empty = await request(app)
      .get(`${API}/portfolio/history?range=30d`)
      .set(...bearer(user))
    expect(empty.body.points).toHaveLength(0)

    await request(app)
      .get(`${API}/portfolio/history?range=foo`)
      .set(...bearer(user))
      .expect(400)
  })
})
