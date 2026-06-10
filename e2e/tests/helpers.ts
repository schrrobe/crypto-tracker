import type { Page } from '@playwright/test'

let counter = 0

// Eindeutige E-Mail je Test (DB wird pro Lauf resettet, aber Tests teilen sich einen Lauf)
export function uniqueEmail(prefix: string): string {
  counter += 1
  return `${prefix}-${process.pid}-${counter}@e2e.test`
}

export const PASSWORD = 'superSicheresPasswort1'

// Ionic-Inputs rendern ein natives <input> im Inneren
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
