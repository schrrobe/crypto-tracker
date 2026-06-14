import { expect, test } from '@playwright/test'
import { input, register, uniqueEmail } from './helpers'

// Fake prices: BTC 50.000 € · ETH 2.000 € · SOL 100 €

const GERMAN_CSV = Buffer.from(
  'Währung;Menge\nBTC;0,25\nETH;1.5\nFOO;abc\nSOL;10\n',
  'utf8',
)

async function uploadCsv(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('tab', { name: 'Quellen' }).click()
  await page.getByTestId('open-csv-import').click()
  await input(page, 'csv-label').fill(label)
  await page.getByTestId('csv-file').setInputFiles({
    name: 'bestand.csv',
    mimeType: 'text/csv',
    buffer: GERMAN_CSV,
  })
  await page.getByTestId('csv-upload').click()
}

test('CSV-Import: Upload, Mapping-Vorschlag, Fehlerzeilen, Bestände', async ({ page }) => {
  await register(page, uniqueEmail('csv'))
  await uploadCsv(page, 'Mein CSV-Import')

  // Mapping step: 4 rows detected, German column names mapped automatically
  await expect(page.getByTestId('csv-row-count')).toContainText('4 Zeilen')
  await expect(page.getByTestId('mapping-symbol')).toContainText('Währung')
  await expect(page.getByTestId('mapping-quantity')).toContainText('Menge')

  await page.getByTestId('csv-import-run').click()

  // Result: 3 of 4, error row 4 ("abc" is not a number) is traceable
  await expect(page.getByTestId('csv-result')).toContainText('3 von 4 Zeilen importiert')
  await expect(page.getByTestId('csv-error-rows')).toContainText('Zeile 4')
  await expect(page.getByTestId('csv-error-rows')).toContainText('keine gültige Zahl')
  await page.getByTestId('csv-done').click()

  // Source appears in the list
  await expect(page.getByTestId('source-Mein CSV-Import')).toBeVisible()
  await expect(page.getByTestId('source-Mein CSV-Import')).toContainText('CSV')

  // 0,25 × 50.000 + 1,5 × 2.000 + 10 × 100 = 16.500 € (FOO has no price)
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('total-value')).toHaveText(/16\.500,00\s€/u)

  await page.getByRole('tab', { name: 'Bestände' }).click()
  await expect(page.getByTestId('holding-BTC')).toContainText('0,25 BTC')
  await expect(page.getByTestId('holding-ETH')).toContainText('1,5 ETH')
  await expect(page.getByTestId('holding-SOL')).toContainText('10 SOL')
})

test('Import-Historie zeigt den Import und löscht ihn samt Quelle', async ({ page }) => {
  await register(page, uniqueEmail('csvhistory'))
  await uploadCsv(page, 'Historien-Test')
  await page.getByTestId('csv-import-run').click()
  await expect(page.getByTestId('csv-result')).toBeVisible()
  await page.getByTestId('csv-done').click()

  await page.getByTestId('open-import-history').click()
  const entry = page.getByTestId('import-bestand.csv')
  await expect(entry).toBeVisible()
  await expect(entry).toContainText('Historien-Test')
  await expect(entry).toContainText('3 von 4 Zeilen importiert')
  await expect(entry).toContainText('1 Fehler')

  await page.getByTestId('import-delete-bestand.csv').click()
  await page.getByRole('button', { name: 'Löschen' }).click()
  await expect(page.getByTestId('imports-empty')).toBeVisible()

  // Source and holdings are gone along with the import
  await page.getByRole('tab', { name: 'Quellen' }).click()
  await expect(page.getByTestId('sources-empty')).toBeVisible()
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('total-value')).toHaveText(/0,00\s€/u)
})

test('aktive Doppel-Erkennung: Börsen-Auswahl warnt bei vorhandener API-Quelle', async ({ page }) => {
  await register(page, uniqueEmail('csvdup'))

  // Connect Kraken via API (default provider in the connect modal)
  await page.getByRole('tab', { name: 'Quellen' }).click()
  await page.getByTestId('add-source').click()
  await input(page, 'source-label').fill('Kraken API')
  await input(page, 'source-api-key').fill('valid-key-1234')
  await input(page, 'source-api-secret').fill('valid-secret')
  await page.getByTestId('source-save').click()
  await expect(page.getByTestId('source-Kraken API')).toBeVisible()

  // Import a generic CSV (no preset), explicitly set the exchange to Kraken
  await page.getByTestId('open-csv-import').click()
  await input(page, 'csv-label').fill('Doppel-Test')
  await page.getByTestId('csv-exchange').click()
  await page.getByRole('radio', { name: 'Kraken' }).click()
  await page.getByTestId('csv-file').setInputFiles({
    name: 'generisch.csv',
    mimeType: 'text/csv',
    buffer: GERMAN_CSV,
  })
  await page.getByTestId('csv-upload').click()

  // Warning appears in the mapping step with the source name
  await expect(page.getByTestId('csv-duplicate-warning')).toBeVisible()
  await expect(page.getByTestId('csv-duplicate-warning')).toContainText('Kraken API')
})

test('unbrauchbare CSV wird beim Upload abgelehnt', async ({ page }) => {
  await register(page, uniqueEmail('csvbad'))
  await page.getByRole('tab', { name: 'Quellen' }).click()
  await page.getByTestId('open-csv-import').click()
  await page.getByTestId('csv-file').setInputFiles({
    name: 'kaputt.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('nur-eine-spalte\nBTC\n', 'utf8'),
  })
  await page.getByTestId('csv-upload').click()
  await expect(page.getByTestId('csv-error')).toContainText('CSV konnte nicht gelesen werden')
})
