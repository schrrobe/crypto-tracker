import { expect, test } from '@playwright/test'
import { input, register, uniqueEmail } from './helpers'

// Fake market_chart: linear 90 % → 100 % of the current price → delta always +11.1 %

test('Wertverlauf-Chart: erscheint mit Beständen, Range-Wechsel, Delta-Prozent', async ({ page }) => {
  await register(page, uniqueEmail('chart'))

  // No chart without holdings
  await expect(page.getByTestId('portfolio-chart')).toHaveCount(0)

  // Record 1 BTC manually
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
  await expect(chart.locator('svg.chart path')).toHaveCount(2) // area + line

  // Fake history rises from 90 % to 100 % → +11.1 %
  await expect(page.getByTestId('chart-delta')).toContainText('+11,1 %')

  // Axis labels: start 45.000 €, end 50.000 € (1 BTC, fake price)
  await expect(chart).toContainText('45.000,00')
  await expect(chart).toContainText('50.000,00')

  // Range switch reloads and stays visible
  await page.getByTestId('chart-range-7d').click()
  await expect(page.getByTestId('chart-delta')).toContainText('+11,1 %')
  await page.getByTestId('chart-range-30d').click()
  await expect(chart.locator('svg.chart path')).toHaveCount(2)

  // Currency toggle: USD history (fake: BTC 55.000 $)
  await page.getByTestId('total-value-card').click()
  await expect(chart).toContainText('55.000,00')
})

test('Wertverlauf-Chart: 1J-Tipp (Free) öffnet Paywall ohne Range-Wechsel', async ({ page }) => {
  await register(page, uniqueEmail('chart1y')) // free plan

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

  // Move off the default range so a stuck selection would be visible
  await page.getByTestId('chart-range-7d').click()
  const segment = chart.locator('ion-segment')
  await expect(segment).toHaveJSProperty('value', '7d')

  // Tapping the Pro-locked 1y range opens the paywall …
  await page.getByTestId('chart-range-1y').click()
  await expect(page.getByTestId('paywall-close')).toBeVisible()
  await page.getByTestId('paywall-close').click()

  // … and the switcher must snap back to 7d, never stay stuck on 1y.
  await expect(segment).toHaveJSProperty('value', '7d')
  await expect(chart.locator('ion-segment')).toHaveCount(1) // no leaked remounts
})
