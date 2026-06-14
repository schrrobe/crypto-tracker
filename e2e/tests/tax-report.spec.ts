import { expect, test } from '@playwright/test'
import { input, makePro, register, uniqueEmail } from './helpers'

// FAKE_PRICES=true: backfill daily prices are deterministic (80–100 % of the fake price)

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

test('manuelle Transaktionen: erfassen, Bestand abgeleitet, Steuerreport mit CSV-Export', async ({ page }) => {
  await register(page, uniqueEmail('tax'))
  await makePro(page)

  // Reach the transactions page via Sources
  await page.getByRole('tab', { name: 'Quellen' }).click()
  await page.getByTestId('open-transactions').click()
  await expect(page.getByTestId('transactions-empty')).toBeVisible()

  // Buy 2023: 2 BTC at 20.000 € — sell 2024: 1 BTC at 30.000 €
  await addTransaction(page, {
    search: 'bitcoin',
    symbol: 'BTC',
    qty: '2',
    price: '20000',
    timestamp: '2023-01-15T10:00',
  })
  await expect(page.getByTestId('tx-BTC-BUY')).toBeVisible()

  await addTransaction(page, {
    search: 'bitcoin',
    symbol: 'BTC',
    type: 'Verkauf',
    qty: '1',
    price: '30000',
    timestamp: '2024-06-15T10:00',
  })
  await expect(page.getByTestId('tx-BTC-SELL')).toBeVisible()

  // derived holding: 1 BTC × 50.000 € fake price
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('total-value')).toHaveText(/50\.000,00\s€/u)

  // Tax report DE 2024
  await page.getByRole('tab', { name: 'Einstellungen' }).click()
  await page.getByTestId('open-tax-report').click()
  await expect(page.getByTestId('tax-disclaimer')).toBeVisible()

  await page.getByTestId('tax-year').click()
  await page.locator('ion-popover ion-radio', { hasText: '2024' }).click()

  // Sell 15.06.2024, buy 15.01.2023 → > 1 year → tax-free
  const disposal = page.getByTestId('tax-disposal-BTC')
  await expect(disposal).toBeVisible()
  await expect(disposal).toContainText('steuerfrei')
  await expect(page.getByTestId('tax-total-gain')).toContainText('10.000,00')
  await expect(page.getByTestId('tax-taxable-final')).toContainText('0,00')

  // Country switch AT: Neuvermögen, taxable
  await page.getByTestId('tax-country').click()
  await page.locator('ion-popover ion-radio', { hasText: 'Österreich' }).click()
  await expect(page.getByTestId('tax-disposal-BTC')).toContainText('steuerpflichtig')
  await expect(page.getByTestId('tax-neuvermoegen')).toContainText('10.000,00')

  // CSV export
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('tax-export-csv').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('steuerreport-AT-2024.csv')

  // PDF export
  const pdfPromise = page.waitForEvent('download')
  await page.getByTestId('tax-export-pdf').click()
  const pdf = await pdfPromise
  expect(pdf.suggestedFilename()).toBe('steuerreport-AT-2024.pdf')
})

test('Transfer verknüpfen: Kostenbasis bleibt im DE-Report erhalten', async ({ page }) => {
  await register(page, uniqueEmail('tax-transfer'))
  await makePro(page)

  await page.getByRole('tab', { name: 'Quellen' }).click()
  await page.getByTestId('open-transactions').click()

  // Buy 2022 → withdrawal/deposit 2023 (transfer) → sell 2024
  await addTransaction(page, {
    search: 'bitcoin',
    symbol: 'BTC',
    qty: '1',
    price: '10000',
    timestamp: '2022-03-01T10:00',
  })
  await addTransaction(page, {
    search: 'bitcoin',
    symbol: 'BTC',
    type: 'Auszahlung',
    qty: '1',
    timestamp: '2023-03-01T10:00',
  })
  await addTransaction(page, {
    search: 'bitcoin',
    symbol: 'BTC',
    type: 'Einzahlung',
    qty: '1',
    timestamp: '2023-03-01T12:00',
  })
  await addTransaction(page, {
    search: 'bitcoin',
    symbol: 'BTC',
    type: 'Verkauf',
    qty: '1',
    price: '40000',
    timestamp: '2024-06-01T10:00',
  })

  // Link the withdrawal with the deposit
  await page.getByTestId('tx-link-BTC').first().click()
  await page.getByTestId('transfer-candidate-BTC-WITHDRAWAL').or(page.getByTestId('transfer-candidate-BTC-DEPOSIT')).first().click()
  await expect(page.getByTestId('tx-transfer-badge-BTC').first()).toBeVisible()

  // DE report 2024: basis 10.000 preserved, > 1 year → tax-free
  await page.getByRole('tab', { name: 'Einstellungen' }).click()
  await page.getByTestId('open-tax-report').click()
  await page.getByTestId('tax-year').click()
  await page.locator('ion-popover ion-radio', { hasText: '2024' }).click()
  await page.getByTestId('tax-country').click()
  await page.locator('ion-popover ion-radio', { hasText: 'Deutschland' }).click()

  const disposal = page.getByTestId('tax-disposal-BTC')
  await expect(disposal).toBeVisible()
  await expect(disposal).toContainText('steuerfrei')
  await expect(page.getByTestId('tax-total-gain')).toContainText('30.000,00')
})

test('Transaktion ohne Kurs: Backfill-Hinweis im Report, Bearbeiten/Löschen', async ({ page }) => {
  await register(page, uniqueEmail('tax-edit'))
  await makePro(page)

  await page.getByRole('tab', { name: 'Quellen' }).click()
  await page.getByTestId('open-transactions').click()

  // Buy + sell without price → report uses historical fake daily prices
  await addTransaction(page, {
    search: 'solana',
    symbol: 'SOL',
    qty: '10',
    timestamp: '2024-02-01T12:00',
  })
  await expect(page.getByTestId('tx-SOL-BUY')).toBeVisible()
  await addTransaction(page, {
    search: 'solana',
    symbol: 'SOL',
    type: 'Verkauf',
    qty: '10',
    timestamp: '2024-11-01T12:00',
  })

  await page.getByRole('tab', { name: 'Einstellungen' }).click()
  await page.getByTestId('open-tax-report').click()
  await page.getByTestId('tax-year').click()
  await page.locator('ion-popover ion-radio', { hasText: '2024' }).click()

  const disposal = page.getByTestId('tax-disposal-SOL')
  await expect(disposal).toBeVisible()
  await expect(disposal).toContainText('historischer Tagespreis')

  // back: the tab remembers the subpage → directly back on the transaction list
  await page.getByRole('tab', { name: 'Quellen' }).click()
  await page.getByTestId('tx-edit-SOL').first().click()
  await input(page, 'tx-quantity').fill('5')
  await page.getByTestId('tx-save').click()
  await expect(page.getByTestId('tx-SOL-SELL')).toContainText('5')

  await page.getByTestId('tx-delete-SOL').first().click()
  await page.getByRole('button', { name: 'Löschen' }).click()
  await expect(page.getByTestId('tx-SOL-SELL')).toHaveCount(0)
})
