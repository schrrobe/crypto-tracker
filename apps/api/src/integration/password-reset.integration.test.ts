import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { API, app, PASSWORD, registerUser } from './helpers'
import { prisma } from '../lib/prisma'

// Ohne SMTP (Test/local) loggt der Mailer den Reset-Link in die Konsole.
// Wir fangen console.info ab und ziehen den Token aus der URL.
function captureResetToken(spy: ReturnType<typeof vi.spyOn>): string {
  const logged = spy.mock.calls.map((c) => String(c[0])).join('\n')
  const match = logged.match(/reset-password\?token=([A-Za-z0-9_-]+)/)
  if (!match?.[1]) throw new Error(`Kein Reset-Token im Log gefunden:\n${logged}`)
  return match[1]
}

describe('Passwort-Reset (Integration)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('voller Flow: anfordern → Token aus Mail → neues Passwort → Login mit neuem Passwort', async () => {
    const user = await registerUser('reset')
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})

    await request(app).post(`${API}/auth/forgot-password`).send({ email: user.email }).expect(204)
    const token = captureResetToken(spy)

    const newPassword = 'ganzNeuesPasswort9'
    await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: newPassword })
      .expect(204)

    // altes Passwort gilt nicht mehr
    const oldLogin = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: PASSWORD })
    expect(oldLogin.status).toBe(401)

    // neues Passwort funktioniert
    const newLogin = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: newPassword })
    expect(newLogin.status).toBe(200)
  })

  it('Reset beendet bestehende Sessions (Refresh-Token wird ungültig)', async () => {
    const user = await registerUser('reset-session')
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})

    await request(app).post(`${API}/auth/forgot-password`).send({ email: user.email }).expect(204)
    const token = captureResetToken(spy)
    await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: 'nochEinPasswort7' })
      .expect(204)

    // alter Refresh-Token aus der Registrierung ist nach Reset tot
    // (X-Client: native → Token aus dem Body, nicht aus dem Cookie)
    const refresh = await request(app)
      .post(`${API}/auth/refresh`)
      .set('X-Client', 'native')
      .send({ refreshToken: user.refreshToken })
    expect(refresh.status).toBe(401)
  })

  it('Token ist nur einmal verwendbar', async () => {
    const user = await registerUser('reset-once')
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    await request(app).post(`${API}/auth/forgot-password`).send({ email: user.email }).expect(204)
    const token = captureResetToken(spy)

    await request(app).post(`${API}/auth/reset-password`).send({ token, password: 'erstesNeues12' }).expect(204)
    const second = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: 'zweitesNeues34' })
    expect(second.status).toBe(400)
    expect(second.body.error.code).toBe('INVALID_RESET_TOKEN')
  })

  it('ungültiger Token → 400 INVALID_RESET_TOKEN', async () => {
    const res = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token: 'gibtsnicht', password: 'irgendeinPasswort1' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_RESET_TOKEN')
  })

  it('abgelaufener Token → 400', async () => {
    const user = await registerUser('reset-expired')
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    await request(app).post(`${API}/auth/forgot-password`).send({ email: user.email }).expect(204)
    const token = captureResetToken(spy)

    // Token künstlich in die Vergangenheit setzen
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const res = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: 'spaeterNeues12' })
    expect(res.status).toBe(400)
  })

  it('unbekannte E-Mail liefert trotzdem 204 (keine User-Enumeration)', async () => {
    await request(app)
      .post(`${API}/auth/forgot-password`)
      .send({ email: 'niemand-hier@integration.test' })
      .expect(204)
  })

  it('neue Anforderung entwertet den vorherigen Token', async () => {
    const user = await registerUser('reset-reissue')
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})

    await request(app).post(`${API}/auth/forgot-password`).send({ email: user.email }).expect(204)
    const firstToken = captureResetToken(spy)
    spy.mockClear()
    await request(app).post(`${API}/auth/forgot-password`).send({ email: user.email }).expect(204)
    const secondToken = captureResetToken(spy)

    expect(secondToken).not.toBe(firstToken)
    // alter Token ist nach Neuanforderung ungültig
    const old = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token: firstToken, password: 'altWirdAbgelehnt1' })
    expect(old.status).toBe(400)
    // neuer Token funktioniert
    await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token: secondToken, password: 'neuFunktioniert2' })
      .expect(204)
  })
})
