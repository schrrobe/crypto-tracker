import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, request as playwrightRequest, test } from '@playwright/test'
import { PASSWORD, register, uniqueEmail } from './helpers'
import { API_PORT, E2E_DATABASE_URL } from '../config'

const API = `http://localhost:${API_PORT}/api/v1`
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

// Seed an active broadcast announcement through the admin API (no admin UI in
// the E2E harness): register admin, grant admin against the E2E DB, then POST.
async function seedActiveAnnouncement(message: string, opts: { public?: boolean } = {}): Promise<void> {
  const adminEmail = uniqueEmail('ann-admin')
  const ctx = await playwrightRequest.newContext()
  const reg = await ctx.post(`${API}/auth/register`, { data: { email: adminEmail, password: PASSWORD } })
  expect(reg.ok()).toBeTruthy()
  const { accessToken } = await reg.json()

  execSync(`pnpm --filter @crypto-tracker/api admin:grant ${adminEmail}`, {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    cwd: REPO_ROOT,
    stdio: 'ignore',
  })

  const r = await ctx.post(`${API}/admin/announcements`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { level: 'ERROR', messages: { de: message }, defaultLocale: 'de', active: true, public: opts.public ?? false },
  })
  expect(r.ok()).toBeTruthy()
  await ctx.dispose()
}

test('Ankündigung: Banner global sichtbar → schließen → bleibt nach Reload weg', async ({ page }) => {
  const message = `E2E-Hinweis ${process.pid}-${Date.now()}`
  await seedActiveAnnouncement(message)

  await register(page, uniqueEmail('ann-user'))

  const banner = page.getByTestId('announcement').filter({ hasText: message })
  await expect(banner).toBeVisible()

  // dismiss it
  await banner.getByTestId('announcement-dismiss').click()
  await expect(banner).toHaveCount(0)

  // persisted: still gone after a reload
  await page.reload()
  await expect(page.getByTestId('announcement').filter({ hasText: message })).toHaveCount(0)
})

test('Öffentliche Ankündigung: vor Login sichtbar', async ({ page }) => {
  const message = `E2E-Public ${process.pid}-${Date.now()}`
  await seedActiveAnnouncement(message, { public: true })

  // No registration / login — land on the app while logged out.
  await page.goto('/')
  const banner = page.getByTestId('announcement').filter({ hasText: message })
  await expect(banner).toBeVisible()
})
