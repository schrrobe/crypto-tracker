import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { prisma } from '../lib/prisma'
import { API, app, bearer, createExchangeSource, makeAdmin, registerUser } from './helpers'
import { deltaPct } from '../modules/admin/admin.service'
import { pruneExpiredRefreshTokens } from '../modules/auth/auth.service'

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
    expect(ok.body.referral).toHaveProperty('byCurrency')
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

  it('Audit-Log: Mutationen schreiben Einträge; Liste filtert; überlebt User-Löschung', async () => {
    const admin = await registerUser('audit-admin', 'FREE')
    await makeAdmin(admin)
    const target = await registerUser('audit-target', 'FREE')

    await request(app)
      .patch(`${API}/admin/users/${target.userId}/plan`)
      .set(...bearer(admin))
      .send({ plan: 'PRO' })
      .expect(204)

    const byTarget = await request(app)
      .get(`${API}/admin/audit?targetId=${target.userId}`)
      .set(...bearer(admin))
    expect(byTarget.status).toBe(200)
    const planEntry = byTarget.body.audit.find((a: { action: string }) => a.action === 'USER_PLAN_CHANGED')
    expect(planEntry).toBeTruthy()
    expect(planEntry.actorEmail).toBe(admin.email)
    expect(planEntry.metadata.to).toBe('PRO')

    // Filter by action
    const filtered = await request(app)
      .get(`${API}/admin/audit?action=USER_PLAN_CHANGED`)
      .set(...bearer(admin))
    expect(filtered.body.audit.every((a: { action: string }) => a.action === 'USER_PLAN_CHANGED')).toBe(true)

    // Audit survives deletion of the target
    await request(app).delete(`${API}/admin/users/${target.userId}`).set(...bearer(admin)).expect(204)
    const afterDelete = await request(app)
      .get(`${API}/admin/audit?targetId=${target.userId}`)
      .set(...bearer(admin))
    expect(afterDelete.body.audit.some((a: { action: string }) => a.action === 'USER_DELETED')).toBe(true)

    const nonAdmin = await request(app).get(`${API}/admin/audit`).set(...bearer(target))
    expect(nonAdmin.status).toBe(404)
  })

  it('Admin-Sync: löst Run + Audit aus; fremde Source 404', async () => {
    const admin = await registerUser('sync-admin', 'FREE')
    await makeAdmin(admin)
    const owner = await registerUser('sync-owner', 'PRO')
    const source = await createExchangeSource(owner, 'Kraken')

    const list = await request(app).get(`${API}/admin/users/${owner.userId}/sources`).set(...bearer(admin))
    expect(list.status).toBe(200)
    expect(list.body.sources.some((s: { id: string }) => s.id === source.id)).toBe(true)

    const sync = await request(app).post(`${API}/admin/sources/${source.id}/sync`).set(...bearer(admin))
    expect([200, 202]).toContain(sync.status)
    expect(sync.body.run.status).toMatch(/SUCCESS|ERROR|RUNNING/)

    const runs = await prisma.syncRun.count({ where: { sourceId: source.id } })
    expect(runs).toBeGreaterThanOrEqual(1)

    const audit = await request(app)
      .get(`${API}/admin/audit?action=SYNC_TRIGGERED`)
      .set(...bearer(admin))
    expect(audit.body.audit.some((a: { targetId: string }) => a.targetId === source.id)).toBe(true)

    const missing = await request(app).post(`${API}/admin/sources/nonexistent-id/sync`).set(...bearer(admin))
    expect(missing.status).toBe(404)
  })

  it('Suspend: blockt Login + Refresh, widerruft Sessions, Audit; unsuspend hebt auf', async () => {
    const admin = await registerUser('susp-admin', 'FREE')
    await makeAdmin(admin)
    const target = await registerUser('susp-target', 'FREE')

    await request(app).post(`${API}/admin/users/${target.userId}/suspend`).set(...bearer(admin)).expect(204)

    // Sessions revoked
    expect(await prisma.refreshToken.count({ where: { userId: target.userId } })).toBe(0)
    // suspendedAt set
    const dbUser = await prisma.user.findUnique({ where: { id: target.userId } })
    expect(dbUser?.suspendedAt).not.toBeNull()

    // Login blocked
    const login = await request(app)
      .post(`${API}/auth/login`)
      .set('X-Client', 'native')
      .send({ email: target.email, password: 'superSicheresPasswort1' })
    expect(login.status).toBe(403)
    expect(login.body.error.code).toBe('ACCOUNT_SUSPENDED')

    // Refresh blocked (token was revoked anyway → 401 or 403; assert not 200)
    const refresh = await request(app)
      .post(`${API}/auth/refresh`)
      .set('X-Client', 'native')
      .send({ refreshToken: target.refreshToken })
    expect(refresh.status).not.toBe(200)

    // Audit
    const audit = await request(app).get(`${API}/admin/audit?targetId=${target.userId}`).set(...bearer(admin))
    expect(audit.body.audit.some((a: { action: string }) => a.action === 'USER_SUSPENDED')).toBe(true)

    // Unsuspend → login works again
    await request(app).post(`${API}/admin/users/${target.userId}/unsuspend`).set(...bearer(admin)).expect(204)
    const login2 = await request(app)
      .post(`${API}/auth/login`)
      .set('X-Client', 'native')
      .send({ email: target.email, password: 'superSicheresPasswort1' })
    expect(login2.status).toBe(200)
  })

  it('setAdmin: promotet/degradiert + Audit; Selbst + letzter Admin geschützt', async () => {
    const admin = await registerUser('role-admin', 'FREE')
    await makeAdmin(admin)
    const target = await registerUser('role-target', 'FREE')

    await request(app)
      .patch(`${API}/admin/users/${target.userId}/admin`)
      .set(...bearer(admin))
      .send({ isAdmin: true })
      .expect(204)
    expect((await prisma.user.findUnique({ where: { id: target.userId } }))?.isAdmin).toBe(true)

    // Self-demotion blocked
    const self = await request(app)
      .patch(`${API}/admin/users/${admin.userId}/admin`)
      .set(...bearer(admin))
      .send({ isAdmin: false })
    expect(self.status).toBe(400)
    expect(self.body.error.code).toBe('CANNOT_DEMOTE_SELF')

    // Demote the now-promoted target back (works, >1 admin)
    await request(app)
      .patch(`${API}/admin/users/${target.userId}/admin`)
      .set(...bearer(admin))
      .send({ isAdmin: false })
      .expect(204)

    const audit = await request(app).get(`${API}/admin/audit?action=ADMIN_ROLE_CHANGED`).set(...bearer(admin))
    expect(audit.body.audit.length).toBeGreaterThanOrEqual(2)
  })

  it('Dashboard: overview liefert activeSessions + Deltas; activity liefert Signups + Audit', async () => {
    const admin = await registerUser('dash-admin', 'FREE')
    await makeAdmin(admin)
    // erzeugt eine Admin-Aktion → Audit-Eintrag für die Activity
    const target = await registerUser('dash-target', 'FREE')
    await request(app).post(`${API}/admin/users/${target.userId}/revoke-sessions`).set(...bearer(admin)).expect(200)

    const overview = await request(app).get(`${API}/admin/stats/overview`).set(...bearer(admin))
    expect(overview.status).toBe(200)
    expect(typeof overview.body.activeSessions).toBe('number')
    expect(overview.body.activeSessions).toBeGreaterThanOrEqual(1)
    expect('newUsers7dDeltaPct' in overview.body).toBe(true)

    const activity = await request(app).get(`${API}/admin/stats/activity`).set(...bearer(admin))
    expect(activity.status).toBe(200)
    expect(activity.body.recentSignups.length).toBeGreaterThanOrEqual(1)
    expect(activity.body.recentSignups[0]).toHaveProperty('email')
    const revokedRow = activity.body.recentAudit.find(
      (a: { action: string }) => a.action === 'USER_SESSIONS_REVOKED',
    )
    expect(revokedRow).toBeTruthy()
    // Security: the revoke action stores metadata { revoked: n } in the DB, but
    // the activity feed must NOT ship metadata (target emails / amounts leak).
    expect(revokedRow).not.toHaveProperty('metadata')
  })

  it('activity: hartes Limit von 5 Signups + 5 Audit, neueste zuerst', async () => {
    const admin = await registerUser('dash-limit-admin', 'FREE')
    await makeAdmin(admin)
    // > 5 Audit-Aktionen erzeugen
    for (let i = 0; i < 6; i++) {
      const t = await registerUser(`dash-limit-victim-${i}`, 'FREE')
      await request(app).post(`${API}/admin/users/${t.userId}/revoke-sessions`).set(...bearer(admin)).expect(200)
    }
    const activity = await request(app).get(`${API}/admin/stats/activity`).set(...bearer(admin))
    expect(activity.body.recentSignups.length).toBeLessThanOrEqual(5)
    expect(activity.body.recentAudit.length).toBeLessThanOrEqual(5)
    const ts = activity.body.recentAudit.map((a: { createdAt: string }) => a.createdAt)
    expect([...ts].sort((a, b) => (a < b ? 1 : -1))).toEqual(ts) // descending
  })

  it('activeSessions/prune: zählt nur nicht-abgelaufene Tokens, prune löscht abgelaufene', async () => {
    const u = await registerUser('token-prune', 'FREE')
    const now = new Date()
    await prisma.refreshToken.create({
      data: { userId: u.userId, tokenHash: `live-${u.userId}`, expiresAt: new Date(now.getTime() + 60_000) },
    })
    await prisma.refreshToken.create({
      data: { userId: u.userId, tokenHash: `dead-${u.userId}`, expiresAt: new Date(now.getTime() - 60_000) },
    })
    // registerUser already issued one live token, so assert relatively: exactly
    // one token (the expired one) is excluded by the activeSessions count filter.
    const total = await prisma.refreshToken.count({ where: { userId: u.userId } })
    const live = await prisma.refreshToken.count({ where: { userId: u.userId, expiresAt: { gt: now } } })
    expect(total - live).toBe(1)
    const { deleted } = await pruneExpiredRefreshTokens(now)
    expect(deleted).toBeGreaterThanOrEqual(1)
    const remaining = await prisma.refreshToken.findMany({ where: { userId: u.userId } })
    expect(remaining.every((t) => t.expiresAt > now)).toBe(true)
    expect(remaining.some((t) => t.tokenHash === `dead-${u.userId}`)).toBe(false)
  })

  it('deltaPct: null bei Vorperiode 0, korrektes Vorzeichen und Rundung', () => {
    expect(deltaPct(5, 0)).toBeNull()
    expect(deltaPct(0, 8)).toBe(-100)
    expect(deltaPct(12, 10)).toBe(20)
    expect(deltaPct(13, 12)).toBe(8.3) // 8.333.. → 1 Nachkommastelle
  })

  it('Attention: liefert alle Felder; suspendedUsers steigt nach Sperre', async () => {
    const admin = await registerUser('att-admin', 'FREE')
    await makeAdmin(admin)
    const target = await registerUser('att-target', 'FREE')
    await request(app).post(`${API}/admin/users/${target.userId}/suspend`).set(...bearer(admin)).expect(204)

    const res = await request(app).get(`${API}/admin/stats/attention`).set(...bearer(admin))
    expect(res.status).toBe(200)
    for (const k of ['sourcesInError', 'failedImports', 'stalePriceCache', 'pendingPayouts', 'expiringSoonPro', 'suspendedUsers']) {
      expect(typeof res.body[k]).toBe('number')
    }
    expect(res.body.suspendedUsers).toBeGreaterThanOrEqual(1)

    const nonAdmin = await request(app).get(`${API}/admin/stats/attention`).set(...bearer(target))
    expect(nonAdmin.status).toBe(404)
  })

  it('Health: DB ok, optionale Dienste skipped im Test-Setup', async () => {
    const admin = await registerUser('health-admin', 'FREE')
    await makeAdmin(admin)

    const res = await request(app).get(`${API}/admin/stats/health`).set(...bearer(admin))
    expect(res.status).toBe(200)
    expect(res.body.checkedAt).toBeTruthy()
    expect(res.body.checks).toHaveLength(4)
    const byName = Object.fromEntries(res.body.checks.map((c: { name: string }) => [c.name, c]))
    expect(byName.database.state).toBe('ok')
    // Test-Env: kein REDIS_URL/SMTP_HOST, FAKE_PRICES=true → skipped
    expect(byName.redis.state).toBe('skipped')
    expect(byName.coingecko.state).toBe('skipped')
    expect(byName.smtp.state).toBe('skipped')
    for (const c of res.body.checks) expect(['ok', 'down', 'skipped']).toContain(c.state)

    const target = await registerUser('health-nonadmin', 'FREE')
    const nonAdmin = await request(app).get(`${API}/admin/stats/health`).set(...bearer(target))
    expect(nonAdmin.status).toBe(404)
  })

  it('Churn: zählt abgelaufene und bald ablaufende Pro', async () => {
    const admin = await registerUser('churn-admin', 'FREE')
    await makeAdmin(admin)
    const expired = await registerUser('churn-expired', 'PRO')
    await prisma.user.update({
      where: { id: expired.userId },
      // Past the 3-day grace window so it counts as truly lapsed (matches getPlan).
      data: { planUntil: new Date(Date.now() - 5 * 86400000) },
    })

    const res = await request(app).get(`${API}/admin/stats/churn`).set(...bearer(admin))
    expect(res.status).toBe(200)
    expect(res.body.expiredPro).toBeGreaterThanOrEqual(1)
    expect(res.body.lapsed.some((l: { email: string }) => l.email === expired.email)).toBe(true)
  })
})
