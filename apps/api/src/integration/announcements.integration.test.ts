import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { API, app, bearer, makeAdmin, registerUser } from './helpers'

async function createAnnouncement(
  admin: Awaited<ReturnType<typeof registerUser>>,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await request(app).post(`${API}/admin/announcements`).set(...bearer(admin)).send(body)
  expect(res.status).toBe(201)
  return res.body.announcement.id as string
}

describe('Announcements (Integration)', () => {
  it('requireAdmin: Nicht-Admin → 404 auf /admin/announcements', async () => {
    const user = await registerUser('ann-nonadmin', 'FREE')
    const res = await request(app).get(`${API}/admin/announcements`).set(...bearer(user))
    expect(res.status).toBe(404)
  })

  it('aktive Ankündigung erscheint bei Nutzern, ERROR vor INFO', async () => {
    const admin = await registerUser('ann-admin', 'FREE')
    await makeAdmin(admin)
    const infoId = await createAnnouncement(admin, { level: 'INFO', message: 'Wartung geplant', active: true })
    const errId = await createAnnouncement(admin, { level: 'ERROR', message: 'API gestört', active: true })

    const user = await registerUser('ann-user', 'FREE')
    const res = await request(app).get(`${API}/announcements/active`).set(...bearer(user))
    expect(res.status).toBe(200)
    const ids = res.body.announcements.map((a: { id: string }) => a.id)
    expect(ids).toContain(infoId)
    expect(ids).toContain(errId)
    // ERROR sorts before INFO
    expect(ids.indexOf(errId)).toBeLessThan(ids.indexOf(infoId))
  })

  it('inaktive und außerhalb des Zeitfensters liegende werden nicht ausgespielt', async () => {
    const admin = await registerUser('ann-window-admin', 'FREE')
    await makeAdmin(admin)
    const inactiveId = await createAnnouncement(admin, { level: 'INFO', message: 'inaktiv', active: false })
    const futureId = await createAnnouncement(admin, {
      level: 'INFO',
      message: 'startet später',
      active: true,
      startsAt: '2999-01-01T00:00:00.000Z',
    })
    const pastId = await createAnnouncement(admin, {
      level: 'INFO',
      message: 'abgelaufen',
      active: true,
      endsAt: '2000-01-01T00:00:00.000Z',
    })

    const user = await registerUser('ann-window-user', 'FREE')
    const res = await request(app).get(`${API}/announcements/active`).set(...bearer(user))
    const ids = res.body.announcements.map((a: { id: string }) => a.id)
    expect(ids).not.toContain(inactiveId)
    expect(ids).not.toContain(futureId)
    expect(ids).not.toContain(pastId)
  })

  it('CRUD: aktualisieren (deaktivieren) und löschen', async () => {
    const admin = await registerUser('ann-crud-admin', 'FREE')
    await makeAdmin(admin)
    const id = await createAnnouncement(admin, { level: 'ERROR', message: 'temporär', active: true })

    const patch = await request(app)
      .patch(`${API}/admin/announcements/${id}`)
      .set(...bearer(admin))
      .send({ active: false })
    expect(patch.status).toBe(200)
    expect(patch.body.announcement.active).toBe(false)

    // deactivated → no longer served to users
    const user = await registerUser('ann-crud-user', 'FREE')
    const active = await request(app).get(`${API}/announcements/active`).set(...bearer(user))
    expect(active.body.announcements.find((a: { id: string }) => a.id === id)).toBeUndefined()

    const del = await request(app).delete(`${API}/admin/announcements/${id}`).set(...bearer(admin))
    expect(del.status).toBe(204)
    const list = await request(app).get(`${API}/admin/announcements`).set(...bearer(admin))
    expect(list.body.announcements.find((a: { id: string }) => a.id === id)).toBeUndefined()
  })

  it('Validierung: Ende vor Start → 400', async () => {
    const admin = await registerUser('ann-validate-admin', 'FREE')
    await makeAdmin(admin)
    const res = await request(app)
      .post(`${API}/admin/announcements`)
      .set(...bearer(admin))
      .send({
        level: 'INFO',
        message: 'kaputtes Fenster',
        active: true,
        startsAt: '2026-06-10T00:00:00.000Z',
        endsAt: '2026-06-01T00:00:00.000Z',
      })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})
