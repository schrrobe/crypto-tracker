import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { API, app, bearer, makeAdmin, registerUser } from './helpers'
import { prisma } from '../lib/prisma'

type Admin = Awaited<ReturnType<typeof registerUser>>

async function createAnnouncement(admin: Admin, body: Record<string, unknown>): Promise<string> {
  const payload = {
    level: 'INFO',
    messages: { de: 'Standardnachricht' },
    defaultLocale: 'de',
    active: true,
    ...body,
  }
  const res = await request(app).post(`${API}/admin/announcements`).set(...bearer(admin)).send(payload)
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
    const infoId = await createAnnouncement(admin, { level: 'INFO', messages: { de: 'Wartung geplant' } })
    const errId = await createAnnouncement(admin, { level: 'ERROR', messages: { de: 'API gestört' } })

    const user = await registerUser('ann-user', 'FREE')
    const res = await request(app).get(`${API}/announcements/active`).set(...bearer(user))
    expect(res.status).toBe(200)
    const ids = res.body.announcements.map((a: { id: string }) => a.id)
    expect(ids).toContain(infoId)
    expect(ids).toContain(errId)
    // ERROR sorts before INFO (explicit severity weight, not enum order)
    expect(ids.indexOf(errId)).toBeLessThan(ids.indexOf(infoId))
    // DTO carries the locale map + dismiss-key fields, never active/window
    const err = res.body.announcements.find((a: { id: string }) => a.id === errId)
    expect(err.messages.de).toBe('API gestört')
    expect(err.updatedAt).toBeTypeOf('string')
    expect(err.active).toBeUndefined()
    expect(err.startsAt).toBeUndefined()
  })

  it('inaktive, abgelaufene und null-Fenster-Ankündigungen', async () => {
    const admin = await registerUser('ann-window-admin', 'FREE')
    await makeAdmin(admin)
    const inactiveId = await createAnnouncement(admin, { active: false })
    const expiredId = await createAnnouncement(admin, {
      startsAt: '2020-01-01T00:00:00.000Z',
      endsAt: '2020-01-02T00:00:00.000Z',
    })
    const futureId = await createAnnouncement(admin, { startsAt: '2099-01-01T00:00:00.000Z' })
    const alwaysId = await createAnnouncement(admin, {}) // both null → always shown

    const user = await registerUser('ann-window-user', 'FREE')
    const res = await request(app).get(`${API}/announcements/active`).set(...bearer(user))
    const ids = res.body.announcements.map((a: { id: string }) => a.id)
    expect(ids).toContain(alwaysId)
    expect(ids).not.toContain(inactiveId)
    expect(ids).not.toContain(expiredId)
    expect(ids).not.toContain(futureId)
  })

  it('CRUD: aktualisieren (deaktivieren) und löschen', async () => {
    const admin = await registerUser('ann-crud-admin', 'FREE')
    await makeAdmin(admin)
    const id = await createAnnouncement(admin, { messages: { de: 'CRUD' } })
    const patch = await request(app).patch(`${API}/admin/announcements/${id}`).set(...bearer(admin)).send({ active: false })
    expect(patch.status).toBe(200)
    expect(patch.body.announcement.active).toBe(false)

    const user = await registerUser('ann-crud-user', 'FREE')
    const active = await request(app).get(`${API}/announcements/active`).set(...bearer(user))
    expect(active.body.announcements.find((a: { id: string }) => a.id === id)).toBeUndefined()

    const del = await request(app).delete(`${API}/admin/announcements/${id}`).set(...bearer(admin))
    expect(del.status).toBe(204)
  })

  it('PATCH mit nur active ändert Nachricht/Fenster nicht', async () => {
    const admin = await registerUser('ann-partial-admin', 'FREE')
    await makeAdmin(admin)
    const id = await createAnnouncement(admin, { messages: { de: 'unverändert' }, startsAt: '2099-01-01T00:00:00.000Z' })
    await request(app).patch(`${API}/admin/announcements/${id}`).set(...bearer(admin)).send({ active: false })
    const row = await prisma.announcement.findUnique({ where: { id } })
    expect((row?.messages as Record<string, string>).de).toBe('unverändert')
    expect(row?.startsAt?.toISOString()).toBe('2099-01-01T00:00:00.000Z')
  })

  it('Validierung: Ende vor Start → 400 (create)', async () => {
    const admin = await registerUser('ann-validate-admin', 'FREE')
    await makeAdmin(admin)
    const res = await request(app).post(`${API}/admin/announcements`).set(...bearer(admin)).send({
      level: 'INFO',
      messages: { de: 'kaputtes Fenster' },
      defaultLocale: 'de',
      active: true,
      startsAt: '2026-06-10T00:00:00.000Z',
      endsAt: '2026-06-01T00:00:00.000Z',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('C1: PATCH mit Ende vor Start → 400 (merged window)', async () => {
    const admin = await registerUser('ann-c1-admin', 'FREE')
    await makeAdmin(admin)
    const id = await createAnnouncement(admin, { startsAt: '2026-06-10T00:00:00.000Z' })
    // only endsAt in payload; must be validated against the existing startsAt
    const res = await request(app).patch(`${API}/admin/announcements/${id}`).set(...bearer(admin)).send({
      endsAt: '2026-06-01T00:00:00.000Z',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('defaultLocale ohne Nachricht → 400', async () => {
    const admin = await registerUser('ann-dl-admin', 'FREE')
    await makeAdmin(admin)
    const res = await request(app).post(`${API}/admin/announcements`).set(...bearer(admin)).send({
      level: 'INFO',
      messages: { en: 'only english' },
      defaultLocale: 'de',
      active: true,
    })
    expect(res.status).toBe(400)
  })

  it('public endpoint: nur öffentliche Ankündigungen, ohne Auth', async () => {
    const admin = await registerUser('ann-public-admin', 'FREE')
    await makeAdmin(admin)
    const publicId = await createAnnouncement(admin, { level: 'ERROR', messages: { de: 'Wartung' }, public: true })
    const privateId = await createAnnouncement(admin, { messages: { de: 'intern' }, public: false })

    const res = await request(app).get(`${API}/announcements/public`) // no bearer
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toContain('max-age=30')
    const ids = res.body.announcements.map((a: { id: string }) => a.id)
    expect(ids).toContain(publicId)
    expect(ids).not.toContain(privateId)
  })

  it('audit metadata erfasst den Inhalt bei create/update', async () => {
    const admin = await registerUser('ann-audit-admin', 'FREE')
    await makeAdmin(admin)
    const id = await createAnnouncement(admin, { level: 'ERROR', messages: { de: 'audit' }, public: true })
    const log = await prisma.auditLog.findFirst({
      where: { targetId: id, action: 'ANNOUNCEMENT_CREATED' },
    })
    const meta = log?.metadata as Record<string, unknown>
    expect(meta.level).toBe('ERROR')
    expect(meta.public).toBe(true)
    expect((meta.messages as Record<string, string>).de).toBe('audit')
  })
})
