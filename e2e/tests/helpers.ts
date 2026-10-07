import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { API_ENV } from '../config'

let counter = 0

// Unique email per test (DB is reset per run, but tests share a single run)
export function uniqueEmail(prefix: string): string {
  counter += 1
  return `${prefix}-${process.pid}-${counter}@e2e.test`
}

export const PASSWORD = 'superSicheresPasswort1'

// Ionic inputs render a native <input> inside
export function input(page: Page, testId: string) {
  return page.getByTestId(testId).locator('input')
}

export async function register(page: Page, email: string): Promise<void> {
  await page.goto('/register')
  await input(page, 'register-email').fill(email)
  await input(page, 'register-password').fill(PASSWORD)
  await page.getByTestId('register-submit').click()
  await page.waitForURL('**/tabs/dashboard')
}

// Top-bar controls exist once per page and Ionic keeps earlier pages in the DOM.
// During a page transition both instances are briefly visible; wait until exactly
// one remains so the click never lands on the page that is leaving.
export async function visibleControl(page: Page, testId: string) {
  const control = page.locator(`[data-testid="${testId}"]:visible`)
  await expect(control).toHaveCount(1)
  return control
}

// Settings live behind the profile button in the top bar (no longer a tab).
export async function openSettings(page: Page): Promise<void> {
  if (new URL(page.url()).pathname === '/tabs/settings') return
  // Sub-pages (transactions, tax, …) carry a back button instead: go via the overview
  if ((await page.locator('[data-testid="open-settings"]:visible').count()) === 0) {
    await page.getByRole('tab', { name: 'Übersicht' }).click()
    await expect(page.getByTestId('total-value')).toBeVisible()
  }
  await (await visibleControl(page, 'open-settings')).click()
  await page.waitForURL('**/tabs/settings')
}

// Set the plan to Pro via the dev toggle (only visible in the Vite dev build),
// to test Pro features (e.g. tax report) in E2E.
export async function makePro(page: Page): Promise<void> {
  await openSettings(page)
  await page.locator('[data-testid="dev-plan-toggle"] ion-segment-button', { hasText: 'Pro' }).click()
  await page.locator('[data-testid="settings-plan"]:has-text("Pro")').waitFor()
}

// Grant the admin role via the API script (it validates the full API env, so pass
// the E2E server env, not only the database URL), then reload so the app picks it up.
export async function grantAdmin(page: Page, email: string): Promise<void> {
  execSync(`pnpm --filter @crypto-tracker/api admin:grant ${email}`, {
    env: { ...process.env, ...API_ENV },
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    stdio: 'ignore',
  })
  await page.reload()
  await page.waitForURL('**/tabs/**')
}
