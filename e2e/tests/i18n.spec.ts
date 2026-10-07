import { expect, test } from '@playwright/test'
import { openSettings, register, uniqueEmail } from './helpers'

// The app follows the browser language (Playwright: de-DE) and allows a manual switch
// between German, English, French, Polish, Czech and Russian.

async function switchLanguage(page: import('@playwright/test').Page, name: string) {
  // The previous popover must be fully torn down (Ionic overlay animation)
  await expect(page.locator('ion-popover')).toHaveCount(0)
  await page.getByTestId('language-select').click()
  const radio = page.locator('ion-popover ion-radio', { hasText: name })
  await expect(radio).toBeVisible()
  await radio.click()
  await expect(page.locator('ion-popover')).toHaveCount(0)
}

test('Sprachwechsel auf Englisch wirkt sofort und überlebt einen Reload', async ({ page }) => {
  await register(page, uniqueEmail('i18n-en'))

  // Default follows the browser language de-DE
  await expect(page.getByRole('tab', { name: 'Bestände' })).toBeVisible()
  await openSettings(page)

  await switchLanguage(page, 'English')

  // UI immediately in English (tabs and the profile entry)
  await expect(page.getByRole('tab', { name: 'Holdings' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible()
  await expect(page.getByTestId('logout-button')).toContainText('Sign out')

  // Choice is persisted
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible()
  await openSettings(page)
  await expect(page.getByTestId('logout-button')).toContainText('Sign out')

  // Overview speaks English too
  await page.getByRole('tab', { name: 'Overview' }).click()
  await expect(page.getByTestId('dashboard-empty')).toContainText('Your statement is still empty')
})

test('alle sechs Sprachen sind wählbar und übersetzen die Tabs', async ({ page }) => {
  await register(page, uniqueEmail('i18n-all'))
  await openSettings(page)

  const expectations: Array<[string, string]> = [
    ['Français', 'Avoirs'],
    ['Polski', 'Aktywa'],
    ['Čeština', 'Aktiva'],
    ['Русский', 'Активы'],
    ['Deutsch', 'Bestände'],
  ]

  for (const [language, holdingsTab] of expectations) {
    await switchLanguage(page, language)
    await expect(page.getByRole('tab', { name: holdingsTab })).toBeVisible()
  }
})
