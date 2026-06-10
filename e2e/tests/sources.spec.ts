import { expect, test } from '@playwright/test'
import { input, register, uniqueEmail } from './helpers'

// FAKE_PROVIDERS=true im E2E-API-Server:
//   Exchange-Sync liefert 0,1 BTC + 2 ETH (Fake-Preise: BTC 50.000 €, ETH 2.000 €)
//   Bitcoin-Wallet liefert 0,05 BTC · apiKey "INVALID…" → Ablehnung · "SYNCFAIL…" → Sync-Fehler

async function openSourceModal(page: import('@playwright/test').Page) {
  await page.getByRole('tab', { name: 'Quellen' }).click()
  await page.getByTestId('add-source').click()
}

test('Exchange verbinden, synchronisieren, Bestände erscheinen', async ({ page }) => {
  await register(page, uniqueEmail('exchange'))
  await openSourceModal(page)

  await input(page, 'source-label').fill('Kraken Test')
  await input(page, 'source-api-key').fill('valid-key-1234')
  await input(page, 'source-api-secret').fill('valid-secret')
  await page.getByTestId('source-save').click()

  const item = page.getByTestId('source-Kraken Test')
  await expect(item).toBeVisible()
  await expect(item).toContainText('Key …1234')
  await expect(item).toContainText('nie synchronisiert')

  await page.getByTestId('source-sync-Kraken Test').click()
  await expect(item).toContainText('gerade eben')

  // 0,1 BTC × 50.000 + 2 ETH × 2.000 = 9.000 €
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('total-value')).toHaveText(/9\.000,00\s€/u)

  await page.getByRole('tab', { name: 'Bestände' }).click()
  await expect(page.getByTestId('holding-BTC')).toContainText('0,1 BTC')
  await expect(page.getByTestId('holding-ETH')).toContainText('2 ETH')
})

test('abgelehnter API-Key zeigt Fehler im Formular', async ({ page }) => {
  await register(page, uniqueEmail('invalidkey'))
  await openSourceModal(page)

  await input(page, 'source-label').fill('Kaputt')
  await input(page, 'source-api-key').fill('INVALID-key')
  await input(page, 'source-api-secret').fill('whatever-secret')
  await page.getByTestId('source-save').click()

  await expect(page.getByTestId('source-error')).toContainText('abgelehnt')
  await page.getByTestId('source-modal-cancel').click()
  await expect(page.getByTestId('sources-empty')).toBeVisible()
})

test('fehlgeschlagener Sync landet als Fehler-Badge am SyncRun', async ({ page }) => {
  await register(page, uniqueEmail('syncfail'))
  await openSourceModal(page)

  await input(page, 'source-label').fill('Wackelig')
  await input(page, 'source-api-key').fill('SYNCFAIL-key')
  await input(page, 'source-api-secret').fill('valid-secret')
  await page.getByTestId('source-save').click()

  await page.getByTestId('source-sync-Wackelig').click()
  await expect(page.getByTestId('source-Wackelig')).toContainText('Fehler: Anbieter nicht erreichbar')

  // Bestände bleiben leer, kein halber Sync
  await page.getByRole('tab', { name: 'Bestände' }).click()
  await expect(page.getByTestId('holdings-empty')).toBeVisible()
})

test('Bitcoin-Wallet verbinden und über "Alle" synchronisieren', async ({ page }) => {
  await register(page, uniqueEmail('wallet'))
  await openSourceModal(page)

  await page.getByTestId('source-type-wallet').click()
  await input(page, 'source-label').fill('Cold Wallet')
  await input(page, 'source-address').fill('bc1qtestadresse123456789')
  await page.getByTestId('source-save').click()

  const item = page.getByTestId('source-Cold Wallet')
  await expect(item).toBeVisible()
  await expect(item).toContainText('bc1qtest…456789')

  await page.getByTestId('sync-all').click()
  await expect(item).toContainText('gerade eben')

  // 0,05 BTC × 50.000 = 2.500 €
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('total-value')).toHaveText(/2\.500,00\s€/u)
})

test('Quelle löschen entfernt auch ihre Bestände', async ({ page }) => {
  await register(page, uniqueEmail('deletesource'))
  await openSourceModal(page)

  await input(page, 'source-label').fill('Temporär')
  await input(page, 'source-api-key').fill('valid-key-9999')
  await input(page, 'source-api-secret').fill('valid-secret')
  await page.getByTestId('source-save').click()
  await page.getByTestId('source-sync-Temporär').click()
  await expect(page.getByTestId('source-Temporär')).toContainText('gerade eben')

  await page.getByTestId('source-delete-Temporär').click()
  await page.getByRole('button', { name: 'Löschen' }).click()
  await expect(page.getByTestId('sources-empty')).toBeVisible()

  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('total-value')).toHaveText(/0,00\s€/u)
})
