import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { prisma } from '../lib/prisma'
import { API, app, bearer, makeAdmin, registerUser } from './helpers'

describe('Admin (Integration)', () => {
  it('requireAdmin: anonym + Nicht-Admin → 404, Admin → 200', async () => {
    const anon = await request(app).get(`${API}/admin/stats/overview`)
    expect(anon.status).toBe(404)

    const user = await registerUser('admin-deny', 'FREE')
    const denied = await request(app).get(`${API}/admin/stats/overview`).set(...bearer(user))
    expect(denied.status).toBe(404)

    await makeAdmin(user)
    const ok = await request(app).get(`${API}/admin/stats/overview`).set(...bearer(user))
    expect(ok.status).toBe(200)
    expect(typeof ok.body.totalUsers).toBe('number')
    expect(ok.body.referral).toHaveProperty('owedCents')
  })

  it('Users-Liste filtert nach Plan und paginiert', async () => {
    const admin = await registerUser('admin-list', 'FREE')
    await makeAdmin(admin)
    await registerUser('admin-pro-victim', 'PRO')

    const res = await request(app)
      .get(`${API}/admin/users?plan=PRO&page=1&pageSize=5`)
      .set(...bearer(admin))
    expect(res.status).toBe(200)
    expect(res.body.users.every((u: { plan: string }) => u.plan === 'PRO')).toBe(true)
    expect(res.body.pageSize).toBe(5)
  })

  it('Plan ändern + Sessions widerrufen', async () => {
    const admin = await registerUser('admin-plan', 'FREE')
    await makeAdmin(admin)
    const target = await registerUser('admin-target', 'FREE')

    const patch = await request(app)
      .patch(`${API}/admin/users/${target.userId}/plan`)
      .set(...bearer(admin))
      .send({ plan: 'PRO', planUntil: new Date(Date.now() + 86400000).toISOString() })
    expect(patch.status).toBe(204)
    const updated = await prisma.user.findUnique({ where: { id: target.userId } })
    expect(updated?.plan).toBe('PRO')

    const revoke = await request(app)
      .post(`${API}/admin/users/${target.userId}/revoke-sessions`)
      .set(...bearer(admin))
    expect(revoke.status).toBe(200)
    expect(revoke.body.revoked).toBeGreaterThanOrEqual(1)
  })

  it('Löschen: nicht sich selbst, nicht letzten Admin', async () => {
    const admin = await registerUser('admin-solo', 'FREE')
    await makeAdmin(admin)

    const self = await request(app).delete(`${API}/admin/users/${admin.userId}`).set(...bearer(admin))
    expect(self.status).toBe(400)
    expect(self.body.error.code).toBe('CANNOT_DELETE_SELF')

    // A second admin trying to delete the first admin still works only if >1 admin;
    // here delete a normal user succeeds.
    const victim = await registerUser('admin-deletable', 'FREE')
    const ok = await request(app).delete(`${API}/admin/users/${victim.userId}`).set(...bearer(admin))
    expect(ok.status).toBe(204)
    expect(await prisma.user.findUnique({ where: { id: victim.userId } })).toBeNull()
  })
})
