import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { API, app, PASSWORD, registerUser, uniqueEmail } from './helpers'

describe('Auth (Integration)', () => {
  it('Registrierung liefert User + Token-Paar, /me funktioniert', async () => {
    const user = await registerUser('auth')
    const me = await request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${user.token}`)
    expect(me.status).toBe(200)
    expect(me.body.user.email).toBe(user.email)
  })

  it('doppelte E-Mail wird mit EMAIL_TAKEN abgelehnt', async () => {
    const user = await registerUser('dup')
    const res = await request(app)
      .post(`${API}/auth/register`)
      .send({ email: user.email, password: PASSWORD })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('EMAIL_TAKEN')
  })

  it('falsches Passwort liefert generische 401 ohne E-Mail-Enumeration', async () => {
    const user = await registerUser('wrongpw')
    const wrong = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: 'falschesPasswort1' })
    const unknown = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: uniqueEmail('gibtsnicht'), password: 'egalegalegal1' })
    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    // identische Fehlermeldung für beide Fälle
    expect(wrong.body.error.message).toBe(unknown.body.error.message)
  })

  it('Refresh rotiert: alter Token wird ungültig, neuer funktioniert', async () => {
    const user = await registerUser('rotate')

    const first = await request(app).post(`${API}/auth/refresh`).send({ refreshToken: user.refreshToken })
    expect(first.status).toBe(200)
    expect(first.body.refreshToken).not.toBe(user.refreshToken)

    // alter Token ist verbraucht
    const replay = await request(app).post(`${API}/auth/refresh`).send({ refreshToken: user.refreshToken })
    expect(replay.status).toBe(401)

    // neuer Token funktioniert
    const second = await request(app)
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: first.body.refreshToken })
    expect(second.status).toBe(200)
  })

  it('Logout invalidiert den Refresh-Token', async () => {
    const user = await registerUser('logout')
    await request(app).post(`${API}/auth/logout`).send({ refreshToken: user.refreshToken }).expect(204)
    const res = await request(app).post(`${API}/auth/refresh`).send({ refreshToken: user.refreshToken })
    expect(res.status).toBe(401)
  })

  it('geschützte Routen ohne/mit kaputtem Token → 401', async () => {
    await request(app).get(`${API}/portfolio/summary`).expect(401)
    await request(app).get(`${API}/holdings`).set('Authorization', 'Bearer kaputt').expect(401)
  })
})
