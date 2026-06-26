import { expect, test } from '@playwright/test'
import { input, register, uniqueEmail } from './helpers'

test('Multi-Portfolio: anlegen, wechseln, strikte Trennung der Bestände', async ({ page }) => {
  await register(page, uniqueEmail('portfolios'))

  // BTC holding in the default portfolio
  await page.getByRole('tab', { name: 'Bestände' }).click()
  await page.getByTestId('add-holding').click()
  await page.getByTestId('asset-search').locator('input').fill('bitcoin')
  await page.getByTestId('asset-option-BTC').click()
  await input(page, 'holding-quantity').fill('1')
  await page.getByTestId('holding-save').click()
  await expect(page.getByTestId('holding-BTC')).toBeVisible()

  // create a second portfolio
  await page.getByRole('tab', { name: 'Einstellungen' }).click()
  await page.getByTestId('portfolio-create').click()
  await page.locator('ion-alert input').fill('Eltern')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByTestId('portfolio-Eltern')).toBeVisible()

  // Switcher appears (previously invisible) → switch to Eltern
  await page.locator('[data-testid="portfolio-switcher"]:visible').click()
  // The switcher sits in every tab header → multiple action-sheet instances.
  // Ionic appends the most recently presented overlay at the end of the body → .last() is
  // the interactive one; the button triggers the same store action.
  await page.locator('ion-action-sheet').getByRole('button', { name: 'Eltern' }).last().click()

  // Eltern portfolio is empty
  await page.getByRole('tab', { name: 'Bestände' }).click()
  await expect(page.getByTestId('holdings-empty')).toBeVisible()
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('total-value')).toHaveText(/0,00\s€/u)

  // back to the default → BTC is there again
  await page.locator('[data-testid="portfolio-switcher"]:visible').click()
  await page
    .locator('ion-action-sheet')
    .getByRole('button', { name: /Mein Portfolio/ })
    .last()
    .click()
  await page.getByRole('tab', { name: 'Bestände' }).click()
  await expect(page.getByTestId('holding-BTC')).toBeVisible()
})

test('Portfolio-Löschregeln: letztes und nicht-leeres Portfolio blockiert', async ({ page }) => {
  await register(page, uniqueEmail('pf-rules'))
  await page.getByRole('tab', { name: 'Einstellungen' }).click()

  // delete the last portfolio → error text
  await page.getByTestId('portfolio-delete-Mein Portfolio').click()
  await page.getByRole('button', { name: 'Löschen' }).click()
  await expect(page.getByTestId('portfolio-error')).toContainText('letzte Steuersubjekt')
})
