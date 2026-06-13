import { expect, test } from '@playwright/test'
import { input, register, uniqueEmail } from './helpers'

test('Multi-Portfolio: anlegen, wechseln, strikte Trennung der Bestände', async ({ page }) => {
  await register(page, uniqueEmail('portfolios'))

  // BTC-Bestand im Default-Portfolio
  await page.getByRole('tab', { name: 'Bestände' }).click()
  await page.getByTestId('add-holding').click()
  await page.getByTestId('asset-search').locator('input').fill('bitcoin')
  await page.getByTestId('asset-option-BTC').click()
  await input(page, 'holding-quantity').fill('1')
  await page.getByTestId('holding-save').click()
  await expect(page.getByTestId('holding-BTC')).toBeVisible()

  // zweites Portfolio anlegen
  await page.getByRole('tab', { name: 'Einstellungen' }).click()
  await page.getByTestId('portfolio-create').click()
  await page.locator('ion-alert input').fill('Eltern')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByTestId('portfolio-Eltern')).toBeVisible()

  // Switcher erscheint (vorher unsichtbar) → zu Eltern wechseln
  await page.locator('[data-testid="portfolio-switcher"]:visible').click()
  await page.getByRole('button', { name: 'Eltern' }).click()

  // Eltern-Portfolio ist leer
  await page.getByRole('tab', { name: 'Bestände' }).click()
  await expect(page.getByTestId('holdings-empty')).toBeVisible()
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('total-value')).toHaveText(/0,00\s€/u)

  // zurück zum Default → BTC wieder da
  await page.locator('[data-testid="portfolio-switcher"]:visible').click()
  await page.getByRole('button', { name: /Mein Portfolio/ }).click()
  await page.getByRole('tab', { name: 'Bestände' }).click()
  await expect(page.getByTestId('holding-BTC')).toBeVisible()
})

test('Portfolio-Löschregeln: letztes und nicht-leeres Portfolio blockiert', async ({ page }) => {
  await register(page, uniqueEmail('pf-rules'))
  await page.getByRole('tab', { name: 'Einstellungen' }).click()

  // letztes Portfolio löschen → Fehlertext
  await page.getByTestId('portfolio-delete-Mein Portfolio').click()
  await page.getByRole('button', { name: 'Löschen' }).click()
  await expect(page.getByTestId('portfolio-error')).toContainText('letzte Portfolio')
})
