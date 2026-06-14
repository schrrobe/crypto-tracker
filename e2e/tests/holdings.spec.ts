import { expect, test } from '@playwright/test'
import { input, register, uniqueEmail } from './helpers'

// FAKE_PRICES=true im E2E-API-Server: BTC = 50.000 EUR / 55.000 USD, SOL = 100 EUR

test('manueller Bestand: anlegen, bewerten, bearbeiten, löschen', async ({ page }) => {
  await register(page, uniqueEmail('holdings'))

  // Leeres Dashboard
  await expect(page.getByTestId('total-value')).toHaveText(/0,00\s€/u)
  await expect(page.getByTestId('dashboard-empty')).toBeVisible()

  // BTC 0,5 anlegen
  await page.getByRole('tab', { name: 'Bestände' }).click()
  await expect(page.getByTestId('holdings-empty')).toBeVisible()
  await page.getByTestId('add-holding').click()
  await page.getByTestId('asset-search').locator('input').fill('bitcoin')
  await page.getByTestId('asset-option-BTC').click()
  await input(page, 'holding-quantity').fill('0,5')
  await page.getByTestId('holding-save').click()

  const btcItem = page.getByTestId('holding-BTC')
  await expect(btcItem).toBeVisible()
  await expect(btcItem).toContainText('0,5 BTC')
  await expect(btcItem).toContainText('25.000,00')

  // Dashboard: 0,5 × 50.000 € = 25.000 €, Toggle → 27.500 $
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('total-value')).toHaveText(/25\.000,00\s€/u)
  await page.getByTestId('total-value-card').click()
  await expect(page.getByTestId('total-value')).toHaveText(/27\.500,00\s\$/u)
  await page.getByTestId('total-value-card').click()

  // Menge auf 1 ändern → 50.000 €
  await page.getByRole('tab', { name: 'Bestände' }).click()
  await page.getByTestId('holding-edit-BTC').click()
  await input(page, 'holding-quantity').fill('1')
  await page.getByTestId('holding-save').click()
  await expect(btcItem).toContainText('50.000,00')

  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('total-value')).toHaveText(/50\.000,00\s€/u)

  // Löschen → leerer Zustand
  await page.getByRole('tab', { name: 'Bestände' }).click()
  await page.getByTestId('holding-delete-BTC').click()
  await page.getByRole('button', { name: 'Löschen' }).click()
  await expect(page.getByTestId('holdings-empty')).toBeVisible()
})

test('Privatsphäre-Modus blendet Beträge aus und wieder ein', async ({ page }) => {
  await register(page, uniqueEmail('privacy'))

  await page.getByRole('tab', { name: 'Bestände' }).click()
  await page.getByTestId('add-holding').click()
  await page.getByTestId('asset-search').locator('input').fill('bitcoin')
  await page.getByTestId('asset-option-BTC').click()
  await input(page, 'holding-quantity').fill('1')
  await page.getByTestId('holding-save').click()

  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('total-value')).toHaveText(/50\.000,00\s€/u)

  // ausblenden → Maske
  await page.locator('[data-testid="toggle-balances"]:visible').click()
  await expect(page.getByTestId('total-value')).toContainText('••••')

  // wieder einblenden → Betrag zurück
  await page.locator('[data-testid="toggle-balances"]:visible').click()
  await expect(page.getByTestId('total-value')).toHaveText(/50\.000,00\s€/u)
})

test('doppeltes Asset in derselben Quelle wird abgelehnt', async ({ page }) => {
  await register(page, uniqueEmail('duplicate'))
  await page.getByRole('tab', { name: 'Bestände' }).click()

  for (const [index, quantity] of [['1', '1'], ['2', '2']].entries()) {
    await page.getByTestId('add-holding').click()
    await page.getByTestId('asset-search').locator('input').fill('solana')
    await page.getByTestId('asset-option-SOL').click()
    await input(page, 'holding-quantity').fill(quantity[1])
    await page.getByTestId('holding-save').click()
    if (index === 0) {
      await expect(page.getByTestId('holding-SOL')).toBeVisible()
    }
  }

  await expect(page.getByTestId('holding-error')).toContainText('bereits erfasst')
  await page.getByTestId('holding-modal-cancel').click()
})

test('Konten-Aufteilung: Earn/Margin-Gruppen, negative Margin, Futures-Positionen', async ({ page }) => {
  await register(page, uniqueEmail('breakdown'))

  // Binance-Fake liefert Multi-Konto: SPOT BTC/ETH, EARN BTC, MARGIN -300 USDT + 2 Futures
  await page.getByRole('tab', { name: 'Quellen' }).click()
  await page.getByTestId('add-source').click()
  await page.getByTestId('exchange-provider').click()
  await page.getByRole('radio', { name: 'Binance' }).click()
  await input(page, 'source-label').fill('Binance Test')
  await input(page, 'source-api-key').fill('valid-key-1234')
  await input(page, 'source-api-secret').fill('valid-secret')
  await page.getByTestId('source-save').click()
  await page.getByTestId('source-sync-Binance Test').click()
  await expect(page.getByTestId('source-Binance Test')).toContainText('gerade eben')

  // Bestände: Gruppen je Kontotyp + Badges
  await page.getByRole('tab', { name: 'Bestände' }).click()
  await expect(page.getByTestId('holdings-group-SPOT')).toBeVisible()
  await expect(page.getByTestId('holdings-group-EARN')).toBeVisible()
  await expect(page.getByTestId('holdings-group-MARGIN')).toBeVisible()
  await expect(page.getByTestId('holding-badge-MARGIN')).toContainText('Margin')

  // negative Margin (USDT -300 × 0,9 € = -270 €) rot
  const marginGroup = page.getByTestId('holdings-group-MARGIN')
  await expect(marginGroup).toContainText('-270,00')
  await expect(marginGroup.locator('.amount.negative')).toBeVisible()

  // Futures-Positionen: Side + uPnL
  await expect(page.getByTestId('futures-list')).toBeVisible()
  await expect(page.getByTestId('futures-side-BTC')).toContainText('Long')
  await expect(page.getByTestId('futures-side-ETH')).toContainText('Short')
  await expect(page.getByTestId('futures-pnl-BTC')).toBeVisible()

  // Dashboard: Konten-Aufteilungs-Card + Futures-uPnL-Zeile
  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('account-breakdown-card')).toBeVisible()
  await expect(page.getByTestId('breakdown-MARGIN')).toContainText('-270,00')
  await expect(page.getByTestId('breakdown-futures-upnl')).toBeVisible()
})

test('Top-Positionen zeigen mehrere Assets nach Wert sortiert', async ({ page }) => {
  await register(page, uniqueEmail('topassets'))
  await page.getByRole('tab', { name: 'Bestände' }).click()

  for (const [search, symbol, qty] of [
    ['solana', 'SOL', '10'], // 1.000 €
    ['bitcoin', 'BTC', '1'], // 50.000 €
  ]) {
    await page.getByTestId('add-holding').click()
    await page.getByTestId('asset-search').locator('input').fill(search)
    await page.getByTestId(`asset-option-${symbol}`).click()
    await input(page, 'holding-quantity').fill(qty)
    await page.getByTestId('holding-save').click()
    await expect(page.getByTestId(`holding-${symbol}`)).toBeVisible()
  }

  await page.getByRole('tab', { name: 'Dashboard' }).click()
  await expect(page.getByTestId('total-value')).toHaveText(/51\.000,00\s€/u)

  const items = page.locator('ion-list ion-item')
  await expect(items.first()).toContainText('BTC') // größte Position zuerst
})
