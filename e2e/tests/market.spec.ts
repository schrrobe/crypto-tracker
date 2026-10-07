import { expect, test } from '@playwright/test'
import { register, uniqueEmail } from './helpers'

// FAKE_PRICES: 100 deterministic coins (C1…C100), every third one with a negative 24h change

test('Markt-Tab: Top 100, Gewinner und Verlierer', async ({ page }) => {
  await register(page, uniqueEmail('market'))

  await page.getByRole('tab', { name: 'Markt' }).click()
  await expect(page.getByTestId('market-C1')).toBeVisible()
  await expect(page.getByTestId('market-C1')).toContainText('#1')

  // Losers: only coins with a negative change (typographic minus U+2212)
  await page.getByTestId('market-losers').click()
  const rows = page.locator('ol.stmt > li:visible')
  await expect(rows.first()).toContainText(/[−-]\d/)

  // Gainers: positive change
  await page.getByTestId('market-gainers').click()
  await expect(rows.first()).toContainText('+')
})
