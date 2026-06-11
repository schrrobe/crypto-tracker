import { expect, test } from '@playwright/test'
import { input, register, uniqueEmail } from './helpers'

// Fake-market_chart: linear 90 % → 100 % des aktuellen Preises → Delta immer +11,1 %

test('Wertverlauf-Chart: erscheint mit Beständen, Range-Wechsel, Delta-Prozent', async ({ page }) => {
  await register(page, uniqueEmail('chart'))

  // Ohne Bestände kein Chart
  await expect(page.getByTestId('portfolio-chart')).toHaveCount(0)

  // 1 BTC manuell erfassen
  await page.getByRole('tab', { name: 'Bestände' }).click()
  await page.getByTestId('add-holding').click()
  await page.getByTestId('asset-search').locator('input').fill('bitcoin')
  await page.getByTestId('asset-option-BTC').click()
  await input(page, 'holding-quantity').fill('1')
  await page.getByTestId('holding-save').click()
  await expect(page.getByTestId('holding-BTC')).toBeVisible()

  await page.getByRole('tab', { name: 'Dashboard' }).click()
  const chart = page.getByTestId('portfolio-chart')
  await expect(chart).toBeVisible()
  await expect(chart.locator('svg path')).toHaveCount(2) // Fläche + Linie

  // Fake-Verlauf steigt von 90 % auf 100 % → +11,1 %
  await expect(page.getByTestId('chart-delta')).toContainText('+11,1 %')

  // Achsen-Labels: Start 45.000 €, Ende 50.000 € (1 BTC, Fake-Preis)
  await expect(chart).toContainText('45.000,00')
  await expect(chart).toContainText('50.000,00')

  // Range-Wechsel lädt neu und bleibt sichtbar
  await page.getByTestId('chart-range-7d').click()
  await expect(page.getByTestId('chart-delta')).toContainText('+11,1 %')
  await page.getByTestId('chart-range-30d').click()
  await expect(chart.locator('svg path')).toHaveCount(2)

  // Währungs-Toggle: USD-Verlauf (Fake: BTC 55.000 $)
  await page.getByTestId('total-value-card').click()
  await expect(chart).toContainText('55.000,00')
})
