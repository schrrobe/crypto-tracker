import { expect, test } from '@playwright/test'
import { register, uniqueEmail } from './helpers'

// FAKE_PRICES: 100 deterministic coins (C1…C100), every third one with a negative 24h change

test('Markt-Tab: Top 100, Gewinner und Verlierer', async ({ page }) => {
  await register(page, uniqueEmail('market'))

  await page.getByRole('tab', { name: 'Markt' }).click()
  await expect(page.getByTestId('market-C1')).toBeVisible()
  await expect(page.getByTestId('market-C1')).toContainText('#1')

  // Losers: only coins with a negative change
  await page.getByTestId('market-losers').click()
  const first = page.locator('ion-list ion-item').first()
  await expect(first).toContainText('-')

  // Gainers: positive change
  await page.getByTestId('market-gainers').click()
  await expect(page.locator('ion-list ion-item').first()).toContainText('+')
})
