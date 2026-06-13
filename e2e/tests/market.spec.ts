import { expect, test } from '@playwright/test'
import { register, uniqueEmail } from './helpers'

// FAKE_PRICES: 100 deterministische Coins (C1…C100), jeder dritte mit negativer 24h-Änderung

test('Markt-Tab: Top 100, Gewinner und Verlierer', async ({ page }) => {
  await register(page, uniqueEmail('market'))

  await page.getByRole('tab', { name: 'Markt' }).click()
  await expect(page.getByTestId('market-C1')).toBeVisible()
  await expect(page.getByTestId('market-C1')).toContainText('#1')

  // Verlierer: nur Coins mit negativer Änderung
  await page.getByTestId('market-losers').click()
  const first = page.locator('ion-list ion-item').first()
  await expect(first).toContainText('-')

  // Gewinner: positive Änderung
  await page.getByTestId('market-gainers').click()
  await expect(page.locator('ion-list ion-item').first()).toContainText('+')
})
