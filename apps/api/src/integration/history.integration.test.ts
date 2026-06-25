import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { API, app, bearer, createExchangeSource, registerUser, setPlan } from './helpers'

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

  it('24h-USD liefert 25 Punkte und höhere Werte als EUR', async () => {
    const user = await registerUser('history24usd')
    const source = await createExchangeSource(user, '24h USD Exchange')
    await request(app).post(`${API}/sources/${source.id}/sync`).set(...bearer(user)).expect(200)

    const eur = await request(app)
      .get(`${API}/portfolio/history?range=24h&currency=EUR`)
      .set(...bearer(user))
    const usd = await request(app)
      .get(`${API}/portfolio/history?range=24h&currency=USD`)
      .set(...bearer(user))
    expect(usd.body.currency).toBe('USD')
    expect(usd.body.points).toHaveLength(25)
    expect(Number(usd.body.points.at(-1).value)).toBeGreaterThan(Number(eur.body.points.at(-1).value))
  })

  it('mappt alle Assets → excludedAssets=0, Buckets streng aufsteigend & ISO', async () => {
    const user = await registerUser('historymeta')
    const source = await createExchangeSource(user, 'Meta Exchange')
    await request(app).post(`${API}/sources/${source.id}/sync`).set(...bearer(user)).expect(200)

    const res = await request(app)
      .get(`${API}/portfolio/history?range=30d&currency=EUR`)
      .set(...bearer(user))
    expect(res.status).toBe(200)
    // Fake source holds only mapped coins (BTC + ETH) → nothing excluded
    expect(res.body.excludedAssets).toBe(0)
    expect(res.body.points).toHaveLength(31) // 30 buckets + endpoint

    const ts = res.body.points.map((p: { t: string }) => Date.parse(p.t))
    expect(ts.every((t: number) => Number.isFinite(t))).toBe(true)
    for (let i = 1; i < ts.length; i += 1) expect(ts[i]).toBeGreaterThan(ts[i - 1])
    // Last bucket is ~now
    expect(ts.at(-1)).toBeGreaterThan(Date.now() - 60_000)
  })

  it('1-Jahres-Verlauf: Pro=200/53 Punkte, Free=402', async () => {
    const user = await registerUser('history1y') // default plan PRO
    const source = await createExchangeSource(user, '1y Exchange')
    await request(app).post(`${API}/sources/${source.id}/sync`).set(...bearer(user)).expect(200)

    const pro = await request(app)
      .get(`${API}/portfolio/history?range=1y&currency=EUR`)
      .set(...bearer(user))
    expect(pro.status).toBe(200)
    expect(pro.body.points).toHaveLength(53) // 52 buckets + endpoint

    await setPlan(user, 'FREE')
    await request(app)
      .get(`${API}/portfolio/history?range=1y&currency=EUR`)
      .set(...bearer(user))
      .expect(402)
  })

  it('drosselt nach 40 Anfragen/Minute pro User (429 RATE_LIMITED)', async () => {
    const user = await registerUser('historyrl')
    // 40 allowed within the window
    for (let i = 0; i < 40; i += 1) {
      await request(app)
        .get(`${API}/portfolio/history?range=24h&currency=EUR`)
        .set(...bearer(user))
        .expect(200)
    }
    const blocked = await request(app)
      .get(`${API}/portfolio/history?range=24h&currency=EUR`)
      .set(...bearer(user))
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.code).toBe('RATE_LIMITED')

    // Limit is per user → a different user is unaffected
    const other = await registerUser('historyrl2')
    await request(app)
      .get(`${API}/portfolio/history?range=24h&currency=EUR`)
      .set(...bearer(other))
      .expect(200)
  })
})
