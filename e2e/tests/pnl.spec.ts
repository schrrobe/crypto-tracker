import { expect, test } from '@playwright/test'
import { input, makePro, register, uniqueEmail } from './helpers'

test('PnL-Card: Free gesperrt → Paywall, Pro sichtbar', async ({ page }) => {
  await register(page, uniqueEmail('pnl-ui'))

  // manuellen BTC-Bestand anlegen, damit die PnL-Card erscheint
  await page.getByRole('tab', { name: 'Bestände' }).click()
  await page.getByTestId('add-holding').click()
  await page.getByTestId('asset-search').locator('input').fill('bitcoin')
  await page.getByTestId('asset-option-BTC').click()
  await input(page, 'holding-quantity').fill('1')
  await page.getByTestId('holding-save').click()

  // Free: Card mit Schloss → Klick öffnet Paywall
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await page.getByTestId('pnl-card').click()
  await expect(page.getByTestId('paywall-upgrade')).toBeVisible()
  await page.getByTestId('paywall-close').click()
  await expect(page.getByTestId('paywall-upgrade')).toBeHidden()

  // Pro via Dev-Schalter → PnL-Total sichtbar
  await makePro(page)
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('pnl-total')).toBeVisible()
})
