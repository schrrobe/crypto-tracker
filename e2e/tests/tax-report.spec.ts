import { expect, test } from '@playwright/test'
import { input, register, uniqueEmail } from './helpers'

// FAKE_PRICES=true: Backfill-Tagespreise sind deterministisch (80–100 % des Fake-Preises)

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

  // Transaktionsseite über Quellen erreichen
  await page.getByRole('tab', { name: 'Quellen' }).click()
  await page.getByTestId('open-transactions').click()
  await expect(page.getByTestId('transactions-empty')).toBeVisible()

  // Kauf 2023: 2 BTC à 20.000 € — Verkauf 2024: 1 BTC à 30.000 €
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

  // abgeleiteter Bestand: 1 BTC × 50.000 € Fake-Preis
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('total-value')).toHaveText(/50\.000,00\s€/u)

  // Steuerreport DE 2024
  await page.getByRole('tab', { name: 'Einstellungen' }).click()
  await page.getByTestId('open-tax-report').click()
  await expect(page.getByTestId('tax-disclaimer')).toBeVisible()

  await page.getByTestId('tax-year').click()
  await page.locator('ion-popover ion-radio', { hasText: '2024' }).click()

  // Verkauf 15.06.2024, Kauf 15.01.2023 → > 1 Jahr → steuerfrei
  const disposal = page.getByTestId('tax-disposal-BTC')
  await expect(disposal).toBeVisible()
  await expect(disposal).toContainText('steuerfrei')
  await expect(page.getByTestId('tax-total-gain')).toContainText('10.000,00')
  await expect(page.getByTestId('tax-taxable-final')).toContainText('0,00')

  // Länderwechsel AT: Neuvermögen, steuerpflichtig
  await page.getByTestId('tax-country').click()
  await page.locator('ion-popover ion-radio', { hasText: 'Österreich' }).click()
  await expect(page.getByTestId('tax-disposal-BTC')).toContainText('steuerpflichtig')
  await expect(page.getByTestId('tax-neuvermoegen')).toContainText('10.000,00')

  // CSV-Export
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('tax-export-csv').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('steuerreport-AT-2024.csv')
})

test('Transaktion ohne Kurs: Backfill-Hinweis im Report, Bearbeiten/Löschen', async ({ page }) => {
  await register(page, uniqueEmail('tax-edit'))

  await page.getByRole('tab', { name: 'Quellen' }).click()
  await page.getByTestId('open-transactions').click()

  // Kauf + Verkauf ohne Kurs → Report nutzt historische Fake-Tagespreise
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

  // zurück: der Tab merkt sich die Unterseite → direkt wieder auf der Transaktionsliste
  await page.getByRole('tab', { name: 'Quellen' }).click()
  await page.getByTestId('tx-edit-SOL').first().click()
  await input(page, 'tx-quantity').fill('5')
  await page.getByTestId('tx-save').click()
  await expect(page.getByTestId('tx-SOL-SELL')).toContainText('5')

  await page.getByTestId('tx-delete-SOL').first().click()
  await page.getByRole('button', { name: 'Löschen' }).click()
  await expect(page.getByTestId('tx-SOL-SELL')).toHaveCount(0)
})
