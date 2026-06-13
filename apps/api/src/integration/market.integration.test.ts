import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { API, app, bearer, registerUser } from './helpers'

describe('Markt (Integration)', () => {
  it('liefert Top 100 (Fake) mit Rang, Preis und 24h-Änderung', async () => {
    const user = await registerUser('market')
    const res = await request(app).get(`${API}/market?currency=EUR`).set(...bearer(user))
    expect(res.status).toBe(200)
    expect(res.body.coins).toHaveLength(100)
    expect(res.body.coins[0]).toMatchObject({ rank: 1, symbol: 'C1' })
    expect(typeof res.body.coins[0].price).toBe('number')
    // Fake enthält negative 24h-Änderungen (Verlierer-Liste im Frontend)
    expect(res.body.coins.some((c: { change24hPct: number | null }) => (c.change24hPct ?? 0) < 0)).toBe(true)
  })

  it('verlangt Auth und validiert die Währung', async () => {
    const unauthed = await request(app).get(`${API}/market`)
    expect(unauthed.status).toBe(401)
    const user = await registerUser('market-val')
    const bad = await request(app).get(`${API}/market?currency=GBP`).set(...bearer(user))
    expect(bad.status).toBe(400)
  })
})
