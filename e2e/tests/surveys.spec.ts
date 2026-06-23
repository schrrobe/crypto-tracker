import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, request as playwrightRequest, test } from '@playwright/test'
import { PASSWORD, register, uniqueEmail } from './helpers'
import { API_PORT, E2E_DATABASE_URL } from '../config'

const API = `http://localhost:${API_PORT}/api/v1`
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

// Seed a published survey through the admin API (there is no admin UI in the
// E2E harness). Registers an admin user, grants admin via the project's own
// grant script against the E2E DB, then creates + publishes the survey.
async function seedPublishedSurvey(title: string): Promise<void> {
  const adminEmail = uniqueEmail('survey-admin')
  const ctx = await playwrightRequest.newContext()
  const reg = await ctx.post(`${API}/auth/register`, { data: { email: adminEmail, password: PASSWORD } })
  expect(reg.ok()).toBeTruthy()
  const { accessToken } = await reg.json()

  execSync(`pnpm --filter @crypto-tracker/api admin:grant ${adminEmail}`, {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    cwd: REPO_ROOT,
    stdio: 'ignore',
  })

  const headers = { Authorization: `Bearer ${accessToken}` }
  const create = await ctx.post(`${API}/admin/surveys`, {
    headers,
    data: {
      title,
      questions: [
        { type: 'SINGLE_CHOICE', prompt: 'Lieblingsfarbe?', options: [{ label: 'Rot' }, { label: 'Blau' }] },
        { type: 'FREE_TEXT', prompt: 'Welche Wünsche?' },
      ],
    },
  })
  expect(create.ok()).toBeTruthy()
  const { id } = await create.json()
  const pub = await ctx.post(`${API}/admin/surveys/${id}/publish`, { headers })
  expect(pub.ok()).toBeTruthy()
  await ctx.dispose()
}

test('Umfrage: Banner auf Dashboard → ausfüllen → absenden → Banner verschwindet', async ({ page }) => {
  const title = `E2E-Umfrage ${process.pid}-${Date.now()}`
  await seedPublishedSurvey(title)

  await register(page, uniqueEmail('survey-user'))

  // Banner for our specific survey is visible on the dashboard
  const banner = page.getByTestId('survey-banner').filter({ hasText: title })
  await expect(banner).toBeVisible()
  await banner.click()

  // Survey page: answer the choice + free-text questions
  await expect(page.getByText('Lieblingsfarbe?')).toBeVisible()
  await page.locator('ion-radio', { hasText: 'Rot' }).click()
  await page.getByTestId('survey-freetext').locator('textarea').fill('Mehr Charts bitte')
  await page.getByTestId('survey-submit').click()

  // Thank-you state, then back to the dashboard
  await expect(page.getByTestId('survey-thanks')).toBeVisible()
  await page.getByRole('link', { name: 'Zurück' }).click()
  await page.waitForURL('**/tabs/dashboard')

  // Banner for the answered survey is gone (one-per-user 409 path is covered by the integration test)
  await expect(page.getByTestId('survey-banner').filter({ hasText: title })).toHaveCount(0)
})
