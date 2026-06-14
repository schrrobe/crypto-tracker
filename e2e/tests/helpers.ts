import type { Page } from '@playwright/test'

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

// Set the plan to Pro via the dev toggle (only visible in the Vite dev build),
// to test Pro features (e.g. tax report) in E2E.
export async function makePro(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Einstellungen' }).click()
  await page.locator('[data-testid="dev-plan-toggle"] ion-segment-button', { hasText: 'Pro' }).click()
  await page.locator('[data-testid="settings-plan"]:has-text("Pro")').waitFor()
}
