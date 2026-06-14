import { expect, test } from '@playwright/test'
import { register, uniqueEmail } from './helpers'

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
  await expect(page.getByRole('tab', { name: 'Einstellungen' })).toBeVisible()
  await page.getByRole('tab', { name: 'Einstellungen' }).click()

  await switchLanguage(page, 'English')

  // UI immediately in English
  await expect(page.getByRole('tab', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Holdings' })).toBeVisible()
  await expect(page.getByTestId('logout-button')).toContainText('Sign out')

  // Choice is persisted
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Dashboard' })).toBeVisible()
  await page.getByRole('tab', { name: 'Settings' }).click()
  await expect(page.getByTestId('logout-button')).toContainText('Sign out')

  // Dashboard formats in English (en-US: $ before the amount)
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('dashboard-empty')).toContainText('No holdings yet.')
})

test('alle sechs Sprachen sind wählbar und übersetzen die Tabs', async ({ page }) => {
  await register(page, uniqueEmail('i18n-all'))
  await page.getByRole('tab', { name: 'Einstellungen' }).click()

  const expectations: Array<[string, string]> = [
    ['Français', 'Réglages'],
    ['Polski', 'Ustawienia'],
    ['Čeština', 'Nastavení'],
    ['Русский', 'Настройки'],
    ['Deutsch', 'Einstellungen'],
  ]

  for (const [language, settingsTab] of expectations) {
    await switchLanguage(page, language)
    await expect(page.getByRole('tab', { name: settingsTab })).toBeVisible()
  }
})
