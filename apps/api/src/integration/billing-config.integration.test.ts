import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { API, app, bearer, registerUser } from './helpers'

// In the test env no STRIPE_SECRET_KEY is set, so billing is inert. The client
// uses this to hide the Upgrade CTA instead of showing a button that 503s.
describe('GET /billing/config (Integration)', () => {
  it('reports billing disabled and no price when Stripe is unconfigured', async () => {
    const user = await registerUser('billing-config', 'FREE')
    const res = await request(app).get(`${API}/billing/config`).set(...bearer(user))
    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(false)
    expect(res.body.priceLabel).toBeNull()
  })

  it('requires auth', async () => {
    const res = await request(app).get(`${API}/billing/config`)
    expect(res.status).toBe(401)
  })
})
