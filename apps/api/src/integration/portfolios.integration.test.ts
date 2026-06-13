import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { API, app, bearer, createManualSource, createPortfolio, registerUser } from './helpers'

describe('Portfolios (Integration)', () => {
  it('Registrierung legt Default-Portfolio an; CRUD funktioniert', async () => {
    const user = await registerUser('pf-crud')

    const list = await request(app).get(`${API}/portfolios`).set(...bearer(user))
    expect(list.status).toBe(200)
    expect(list.body.portfolios).toHaveLength(1)
    expect(list.body.portfolios[0].isDefault).toBe(true)
    expect(list.body.portfolios[0].label).toBe('Mein Portfolio')

    const created = await createPortfolio(user, 'Eltern')
    expect(created.isDefault).toBe(false)

    const renamed = await request(app)
      .patch(`${API}/portfolios/${created.id}`)
      .set(...bearer(user))
      .send({ label: 'Mama & Papa' })
    expect(renamed.status).toBe(200)
    expect(renamed.body.portfolio.label).toBe('Mama & Papa')

    const del = await request(app).delete(`${API}/portfolios/${created.id}`).set(...bearer(user))
    expect(del.status).toBe(204)
  })

  it('Löschregeln: nicht leer → 409, letztes → 409, Default-Promotion', async () => {
    const user = await registerUser('pf-delete')
    const defaultId = (await request(app).get(`${API}/portfolios`).set(...bearer(user))).body
      .portfolios[0].id as string

    // letztes Portfolio nicht löschbar
    const last = await request(app).delete(`${API}/portfolios/${defaultId}`).set(...bearer(user))
    expect(last.status).toBe(409)
    expect(last.body.error.code).toBe('PORTFOLIO_LAST')

    // nicht-leeres Portfolio nicht löschbar
    const second = await createPortfolio(user, 'Eltern')
    await request(app)
      .post(`${API}/sources`)
      .set(...bearer(user))
      .send({ type: 'MANUAL', label: 'Eltern manuell', portfolioId: second.id })
    const notEmpty = await request(app).delete(`${API}/portfolios/${second.id}`).set(...bearer(user))
    expect(notEmpty.status).toBe(409)
    expect(notEmpty.body.error.code).toBe('PORTFOLIO_NOT_EMPTY')

    // Default löschen (leer) → ältestes verbleibendes wird Default
    const defaultDelete = await request(app)
      .delete(`${API}/portfolios/${defaultId}`)
      .set(...bearer(user))
    expect(defaultDelete.status).toBe(204)
    const after = await request(app).get(`${API}/portfolios`).set(...bearer(user))
    expect(after.body.portfolios).toHaveLength(1)
    expect(after.body.portfolios[0].isDefault).toBe(true)
    expect(after.body.portfolios[0].id).toBe(second.id)
  })

  it('fremde Portfolios sind unsichtbar (404), auch als Scope-Parameter', async () => {
    const owner = await registerUser('pf-owner')
    const stranger = await registerUser('pf-stranger')
    const portfolio = await createPortfolio(owner, 'Privat')

    const patch = await request(app)
      .patch(`${API}/portfolios/${portfolio.id}`)
      .set(...bearer(stranger))
      .send({ label: 'Gekapert' })
    expect(patch.status).toBe(404)

    for (const path of [
      `/portfolio/summary?portfolioId=${portfolio.id}`,
      `/sources?portfolioId=${portfolio.id}`,
      `/tax/report?year=2024&country=DE&portfolioId=${portfolio.id}`,
      `/transactions?portfolioId=${portfolio.id}`,
    ]) {
      const res = await request(app).get(`${API}${path}`).set(...bearer(stranger))
      expect(res.status, path).toBe(404)
    }
  })

  it('Manuelle Quelle ohne portfolioId landet im Default (Kompatibilität)', async () => {
    const user = await registerUser('pf-compat')
    await createManualSource(user, 'Alt-Verhalten')
    const sources = await request(app).get(`${API}/sources`).set(...bearer(user))
    expect(sources.body.sources).toHaveLength(1)
  })
})
