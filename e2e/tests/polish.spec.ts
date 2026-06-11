import { expect, test } from '@playwright/test'
import { input, register, uniqueEmail } from './helpers'

test('Onboarding: drei Einstiege vom leeren Dashboard öffnen die richtigen Flows', async ({ page }) => {
  await register(page, uniqueEmail('onboarding'))
  await expect(page.getByTestId('dashboard-empty')).toBeVisible()

  // Einstieg 1: Quelle verbinden → Quellen-Tab mit offenem Modal
  await page.getByTestId('onboarding-connect').click()
  await expect(page.getByTestId('source-save')).toBeVisible()
  await page.getByTestId('source-modal-cancel').click()

  // Einstieg 2: CSV importieren → Wizard offen
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await page.getByTestId('onboarding-csv').click()
  await expect(page.getByTestId('csv-upload')).toBeVisible()
  await page.getByTestId('csv-cancel').click()

  // Einstieg 3: Manuell erfassen → Bestände-Tab mit offenem Modal
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await page.getByTestId('onboarding-manual').click()
  await expect(page.getByTestId('holding-save')).toBeVisible()
  await page.getByTestId('holding-modal-cancel').click()
})

test('Basiswährung USD wird als Dashboard-Standard übernommen', async ({ page }) => {
  await register(page, uniqueEmail('currency'))

  await page.getByRole('tab', { name: 'Einstellungen' }).click()
  await page.getByTestId('currency-select').click()
  await page.locator('ion-popover ion-radio', { hasText: 'USD' }).click()
  await expect(page.locator('ion-popover')).toHaveCount(0)

  // Bestand anlegen: 1 BTC = 55.000 $ (Fake-Preis USD)
  await page.getByRole('tab', { name: 'Bestände' }).click()
  await page.getByTestId('add-holding').click()
  await page.getByTestId('asset-search').locator('input').fill('bitcoin')
  await page.getByTestId('asset-option-BTC').click()
  await input(page, 'holding-quantity').fill('1')
  await page.getByTestId('holding-save').click()
  await expect(page.getByTestId('holding-BTC')).toBeVisible()

  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('total-value')).toHaveText(/55\.000,00\s\$/u)
})

test('Tokens ohne Preis sind standardmäßig eingeklappt', async ({ page }) => {
  await register(page, uniqueEmail('unpriced'))

  // CSV mit BTC (gemappt) und FOO (unbekannt, kein Preis)
  await page.getByRole('tab', { name: 'Quellen' }).click()
  await page.getByTestId('open-csv-import').click()
  await page.getByTestId('csv-file').setInputFiles({
    name: 'mix.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Coin,Amount\nBTC,1\nFOO,5\n', 'utf8'),
  })
  await page.getByTestId('csv-upload').click()
  await page.getByTestId('csv-import-run').click()
  await expect(page.getByTestId('csv-result')).toContainText('2 von 2')
  await page.getByTestId('csv-done').click()

  await page.getByRole('tab', { name: 'Bestände' }).click()
  await expect(page.getByTestId('holding-BTC')).toBeVisible()
  // FOO ist eingeklappt
  await expect(page.getByTestId('holding-FOO')).toHaveCount(0)

  await page.getByTestId('toggle-unpriced').click()
  await expect(page.getByTestId('holding-FOO')).toBeVisible()
  await page.getByTestId('toggle-unpriced').click()
  await expect(page.getByTestId('holding-FOO')).toHaveCount(0)
})

test('lokalisierter API-Fehler: doppelte E-Mail bei Registrierung', async ({ page }) => {
  const email = uniqueEmail('emailtaken')
  await register(page, email)
  await page.getByRole('tab', { name: 'Einstellungen' }).click()
  await page.getByTestId('logout-button').click()
  await page.waitForURL('**/login')

  await page.getByTestId('goto-register').click()
  await input(page, 'register-email').fill(email)
  await input(page, 'register-password').fill('superSicheresPasswort1')
  await page.getByTestId('register-submit').click()
  await expect(page.getByTestId('register-error')).toContainText(
    'Diese E-Mail-Adresse ist bereits registriert',
  )
})
