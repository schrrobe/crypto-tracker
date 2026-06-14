import { expect, test } from '@playwright/test'
import { input, register, uniqueEmail } from './helpers'

// Fake prices: BTC 50.000 € · SOL 100 € · fookoin 2 €

test('CSV-Transaktions-Import: Typen/Daten validiert, Netto-Bestände berechnet', async ({ page }) => {
  await register(page, uniqueEmail('txcsv'))
  await page.getByRole('tab', { name: 'Quellen' }).click()
  await page.getByTestId('open-csv-import').click()

  await page.getByTestId('csv-kind-transactions').click()
  await input(page, 'csv-label').fill('Trade-Historie')
  await page.getByTestId('csv-file').setInputFiles({
    name: 'trades.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Datum;Typ;Coin;Menge\n' +
        '2024-01-01;Kauf;BTC;1\n' +
        '01.02.2024 14:30;Verkauf;BTC;0,4\n' +
        '2024-03-01;Kauf;SOL;10\n' +
        '2024-04-01;hodl;SOL;5\n', // row 5: unknown type
      'utf8',
    ),
  })
  await page.getByTestId('csv-upload').click()

  // All four columns mapped automatically
  await expect(page.getByTestId('mapping-type')).toContainText('Typ')
  await expect(page.getByTestId('mapping-timestamp')).toContainText('Datum')
  await expect(page.getByTestId('mapping-symbol')).toContainText('Coin')
  await expect(page.getByTestId('mapping-quantity')).toContainText('Menge')

  await page.getByTestId('csv-import-run').click()
  await expect(page.getByTestId('csv-result')).toContainText('3 von 4 Zeilen importiert')
  await expect(page.getByTestId('csv-error-rows')).toContainText('Zeile 5')
  await expect(page.getByTestId('csv-error-rows')).toContainText('kein bekannter Typ')
  await page.getByTestId('csv-done').click()

  // Net: BTC 1 − 0,4 = 0,6 (30.000 €) · SOL +10 (1.000 €)
  await page.getByRole('tab', { name: 'Bestände' }).click()
  await expect(page.getByTestId('holding-BTC')).toContainText('0,6 BTC')
  await expect(page.getByTestId('holding-SOL')).toContainText('10 SOL')
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('total-value')).toHaveText(/31\.000,00\s€/u)
})

test('Allocation-Donut zeigt Anteile der Top-Positionen', async ({ page }) => {
  await register(page, uniqueEmail('donut'))

  // Record 1 BTC (50.000 €) + 10 SOL (1.000 €) manually
  await page.getByRole('tab', { name: 'Bestände' }).click()
  for (const [search, symbol, qty] of [
    ['bitcoin', 'BTC', '1'],
    ['solana', 'SOL', '10'],
  ]) {
    await page.getByTestId('add-holding').click()
    await page.getByTestId('asset-search').locator('input').fill(search)
    await page.getByTestId(`asset-option-${symbol}`).click()
    await input(page, 'holding-quantity').fill(qty)
    await page.getByTestId('holding-save').click()
    await expect(page.getByTestId(`holding-${symbol}`)).toBeVisible()
  }

  await page.getByRole('tab', { name: 'Dashboard' }).click()
  const donut = page.getByTestId('allocation-donut')
  await expect(donut).toBeVisible()
  // de-DE: decimal comma
  await expect(page.getByTestId('allocation-BTC')).toContainText('98,0 %')
  await expect(page.getByTestId('allocation-SOL')).toContainText('2,0 %')
})

test('manuelles Preis-Mapping über die CoinGecko-Suche', async ({ page }) => {
  await register(page, uniqueEmail('mapping'))

  // Asset mappings are global and the E2E DB persists across runs —
  // hence a run-unique symbol (the echo fake returns a unique ID for it)
  const symbol = `M${process.pid % 10000}X${Math.floor(Math.random() * 10000)}`

  await page.getByRole('tab', { name: 'Quellen' }).click()
  await page.getByTestId('open-csv-import').click()
  await page.getByTestId('csv-file').setInputFiles({
    name: 'unmapped.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`Coin,Amount\n${symbol},5\n`, 'utf8'),
  })
  await page.getByTestId('csv-upload').click()
  await page.getByTestId('csv-import-run').click()
  await page.getByTestId('csv-done').click()

  await page.getByRole('tab', { name: 'Bestände' }).click()
  await page.getByTestId('toggle-unpriced').click()
  await expect(page.getByTestId(`holding-${symbol}`)).toBeVisible()

  // Mapping: search is pre-filled with the symbol → pick the echo match
  await page.getByTestId(`holding-map-${symbol}`).click()
  await page.getByTestId(`coingecko-option-${symbol.toLowerCase()}-coin`).click()
  await page.getByTestId('mapping-save').click()

  // Now priced with the fake default 1 €: 5 × 1 € = 5 €
  await expect(page.getByTestId(`holding-${symbol}`)).toContainText('5,00')
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('total-value')).toHaveText(/5,00\s€/u)
})
