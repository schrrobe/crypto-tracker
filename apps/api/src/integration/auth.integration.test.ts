import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { prisma } from '../lib/prisma'
import { API, app, bearer, createExchangeSource, PASSWORD, registerUser, uniqueEmail } from './helpers'

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

  it('Refresh rotiert (nativ): alter Token wird ungültig, neuer funktioniert', async () => {
    const user = await registerUser('rotate')
    const nat = () => request(app).post(`${API}/auth/refresh`).set('X-Client', 'native')

    const first = await nat().send({ refreshToken: user.refreshToken })
    expect(first.status).toBe(200)
    expect(first.body.refreshToken).not.toBe(user.refreshToken)

    // alter Token ist verbraucht
    const replay = await nat().send({ refreshToken: user.refreshToken })
    expect(replay.status).toBe(401)

    // neuer Token funktioniert
    const second = await nat().send({ refreshToken: first.body.refreshToken })
    expect(second.status).toBe(200)
  })

  it('Logout invalidiert den Refresh-Token (nativ)', async () => {
    const user = await registerUser('logout')
    await request(app)
      .post(`${API}/auth/logout`)
      .set('X-Client', 'native')
      .send({ refreshToken: user.refreshToken })
      .expect(204)
    const res = await request(app)
      .post(`${API}/auth/refresh`)
      .set('X-Client', 'native')
      .send({ refreshToken: user.refreshToken })
    expect(res.status).toBe(401)
  })

  it('Web-Modus: Refresh-Token kommt als httpOnly-Cookie, nicht im Body', async () => {
    // Web-Client = ohne X-Client-Header; supertest-Agent als Cookie-Jar
    const agent = request.agent(app)
    const reg = await agent.post(`${API}/auth/register`).send({ email: uniqueEmail('web'), password: PASSWORD })
    expect(reg.status).toBe(201)
    expect(reg.body.accessToken).toBeTruthy()
    // Token NICHT im Body
    expect(reg.body.refreshToken).toBeUndefined()
    // httpOnly-Cookie gesetzt
    const setCookie = String(reg.headers['set-cookie'] ?? '')
    expect(setCookie).toMatch(/rt=/)
    expect(setCookie).toMatch(/HttpOnly/i)

    // Refresh ohne Body funktioniert (Agent sendet das Cookie automatisch mit)
    const refreshed = await agent.post(`${API}/auth/refresh`)
    expect(refreshed.status).toBe(200)
    expect(refreshed.body.accessToken).toBeTruthy()
    expect(refreshed.body.refreshToken).toBeUndefined()

    // Logout löscht das Cookie → danach kein Refresh mehr
    await agent.post(`${API}/auth/logout`).expect(204)
    const afterLogout = await agent.post(`${API}/auth/refresh`)
    expect(afterLogout.status).toBe(401)
  })

  it('geschützte Routen ohne/mit kaputtem Token → 401', async () => {
    await request(app).get(`${API}/portfolio/summary`).expect(401)
    await request(app).get(`${API}/holdings`).set('Authorization', 'Bearer kaputt').expect(401)
  })

  it('Konto-Löschung entfernt Nutzer + Daten, Login danach unmöglich', async () => {
    const user = await registerUser('delete-me')

    // Quelle anlegen (prüft, dass Cascade über die Restrict-FK hinweg funktioniert)
    await createExchangeSource(user, 'Kraken weg')

    await request(app).delete(`${API}/auth/me`).set(...bearer(user)).expect(204)

    // Access-Token gilt nicht mehr (User existiert nicht)
    await request(app).get(`${API}/auth/me`).set(...bearer(user)).expect(401)
    // Login mit den alten Daten schlägt fehl
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: PASSWORD })
    expect(login.status).toBe(401)
    // Alle Quellen des Nutzers sind weg
    expect(await prisma.portfolioSource.count({ where: { userId: user.userId } })).toBe(0)
    expect(await prisma.portfolio.count({ where: { userId: user.userId } })).toBe(0)
  })
})
