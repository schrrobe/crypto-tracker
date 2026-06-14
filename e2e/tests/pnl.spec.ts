import { expect, test } from '@playwright/test'
import { input, makePro, register, uniqueEmail } from './helpers'

async function addTransaction(
  page: import('@playwright/test').Page,
  opts: { search: string; symbol: string; type?: string; qty: string; price?: string; timestamp: string },
) {
  await page.getByTestId('add-transaction').click()
  await page.getByTestId('tx-asset-search').locator('input').fill(opts.search)
  await page.getByTestId(`tx-asset-option-${opts.symbol}`).click()
  if (opts.type) {
    await page.getByTestId('tx-type').click()
    await page.locator('ion-popover ion-radio', { hasText: opts.type }).click()
  }
  await input(page, 'tx-quantity').fill(opts.qty)
  await input(page, 'tx-timestamp').fill(opts.timestamp)
  if (opts.price) await input(page, 'tx-price').fill(opts.price)
  await page.getByTestId('tx-save').click()
}

test('PnL-Card: Free gesperrt → Paywall, Pro zeigt echten Gewinn', async ({ page }) => {
  await register(page, uniqueEmail('pnl-ui'))

  // BUY 1 BTC @ 20.000 € as a transaction → derived holding WITH cost basis.
  // (A purely manual holding would have no basis → PnL would stay empty; then a
  //  visible pnl-total would say nothing.)
  await page.getByRole('tab', { name: 'Quellen' }).click()
  await page.getByTestId('open-transactions').click()
  await addTransaction(page, {
    search: 'bitcoin',
    symbol: 'BTC',
    qty: '1',
    price: '20000',
    timestamp: '2024-01-15T10:00',
  })
  await expect(page.getByTestId('tx-BTC-BUY')).toBeVisible()

  // Free: card with lock → click opens the paywall
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await page.getByTestId('pnl-card').click()
  await expect(page.getByTestId('paywall-upgrade')).toBeVisible()
  await page.getByTestId('paywall-close').click()
  await expect(page.getByTestId('paywall-upgrade')).toBeHidden()

  // Pro via dev toggle → PnL total shows the real gain (1 BTC: 50.000 − 20.000)
  await makePro(page)
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('pnl-total')).toBeVisible()
  await expect(page.getByTestId('pnl-total')).toContainText('30.000')
})
