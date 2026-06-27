import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { API, app, bearer, createManualSource, createPortfolio, registerUser } from './helpers'

type U = Awaited<ReturnType<typeof registerUser>>
async function setPlan(user: U, plan: 'FREE' | 'PRO') {
  // Dev toggle (APP_ENV=local only) — tests run with local
  await request(app).patch(`${API}/auth/me`).set(...bearer(user)).send({ plan }).expect(200)
}

describe('Plan-Gating (Integration)', () => {
  it('Free: Steuerreport → 402 PLAN_UPGRADE_REQUIRED, Pro → 200', async () => {
    const user = await registerUser('gate-tax', 'FREE')
    const free = await request(app).get(`${API}/tax/report?year=2024&country=DE`).set(...bearer(user))
    expect(free.status).toBe(402)
    expect(free.body.error.code).toBe('PLAN_UPGRADE_REQUIRED')
    // 402 carries a machine-readable feature so the client can show contextual copy
    expect(free.body.error.details?.feature).toBe('tax')

    await setPlan(user, 'PRO')
    const pro = await request(app).get(`${API}/tax/report?year=2024&country=DE`).set(...bearer(user))
    expect(pro.status).toBe(200)
  })

  it('Free: 1-Jahres-Verlauf → 402, kürzere Ranges + Pro → 200', async () => {
    const user = await registerUser('gate-hist', 'FREE')
    const free = await request(app).get(`${API}/portfolio/history?range=1y`).set(...bearer(user))
    expect(free.status).toBe(402)
    // 30d is allowed on Free
    await request(app).get(`${API}/portfolio/history?range=30d`).set(...bearer(user)).expect(200)

    await setPlan(user, 'PRO')
    await request(app).get(`${API}/portfolio/history?range=1y`).set(...bearer(user)).expect(200)
  })

  it('Free: 6. Quelle → 402; Pro hebt das Limit auf', async () => {
    const user = await registerUser('gate-src', 'FREE')
    for (let i = 0; i < 5; i++) await createManualSource(user, `Quelle ${i}`)
    // 6th source exceeds the Free limit (5)
    const sixth = await request(app)
      .post(`${API}/sources`)
      .set(...bearer(user))
      .send({ type: 'MANUAL', label: 'Quelle 6' })
    expect(sixth.status).toBe(402)
    expect(sixth.body.error.code).toBe('PLAN_UPGRADE_REQUIRED')
    expect(sixth.body.error.details?.feature).toBe('unlimitedSources')
    expect(sixth.body.error.details?.limit).toBe(5)
    expect(sixth.body.error.details?.used).toBe(5)

    await setPlan(user, 'PRO')
    await createManualSource(user, 'Quelle 6 Pro')
  })

  it('Free: 3. Portfolio → 402; Pro hebt das Limit auf', async () => {
    const user = await registerUser('gate-pf', 'FREE')
    // 1 default portfolio already exists → one more is ok (=2)
    await createPortfolio(user, 'Zweites')
    const third = await request(app)
      .post(`${API}/portfolios`)
      .set(...bearer(user))
      .send({ label: 'Drittes' })
    expect(third.status).toBe(402)
    expect(third.body.error.details?.feature).toBe('unlimitedPortfolios')
    expect(third.body.error.details?.limit).toBe(2)

    await setPlan(user, 'PRO')
    await createPortfolio(user, 'Drittes Pro')
  })
})
