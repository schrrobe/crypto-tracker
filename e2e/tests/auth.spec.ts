import { expect, test } from '@playwright/test'
import { input, PASSWORD, register, uniqueEmail } from './helpers'

test('leitet ohne Anmeldung auf /login um', async ({ page }) => {
  await page.goto('/tabs/dashboard')
  await expect(page).toHaveURL(/\/login/)
})

test('Registrierung führt direkt ins Dashboard', async ({ page }) => {
  const email = uniqueEmail('register')
  await register(page, email)

  await expect(page).toHaveURL(/\/tabs\/dashboard/)
  await page.getByRole('tab', { name: 'Einstellungen' }).click()
  await expect(page.getByTestId('settings-email')).toHaveText(email)
})

test('Registrierung mit zu kurzem Passwort zeigt Fehler', async ({ page }) => {
  await page.goto('/register')
  await input(page, 'register-email').fill(uniqueEmail('shortpw'))
  await input(page, 'register-password').fill('kurz')
  await page.getByTestId('register-submit').click()
  await expect(page.getByTestId('register-error')).toContainText('mindestens 10 Zeichen')
})

test('Login mit falschem Passwort zeigt generischen Fehler', async ({ page }) => {
  const email = uniqueEmail('wrongpw')
  await register(page, email)
  await page.getByRole('tab', { name: 'Einstellungen' }).click()
  await page.getByTestId('logout-button').click()
  await page.waitForURL('**/login')

  await input(page, 'login-email').fill(email)
  await input(page, 'login-password').fill('falschesPasswort123')
  await page.getByTestId('login-submit').click()
  await expect(page.getByTestId('login-error')).toContainText('E-Mail oder Passwort ist falsch')
})

test('Logout und erneuter Login funktionieren', async ({ page }) => {
  const email = uniqueEmail('relogin')
  await register(page, email)

  await page.getByRole('tab', { name: 'Einstellungen' }).click()
  await page.getByTestId('logout-button').click()
  await page.waitForURL('**/login')

  // Geschützte Route bleibt nach Logout gesperrt
  await page.goto('/tabs/dashboard')
  await expect(page).toHaveURL(/\/login/)

  await input(page, 'login-email').fill(email)
  await input(page, 'login-password').fill(PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL('**/tabs/dashboard')
  await expect(page).toHaveURL(/\/tabs\/dashboard/)
})

test('Passwort vergessen: Anfrage zeigt neutrale Bestätigung', async ({ page }) => {
  const email = uniqueEmail('forgot')
  await register(page, email)
  await page.getByRole('tab', { name: 'Einstellungen' }).click()
  await page.getByTestId('logout-button').click()
  await page.waitForURL('**/login')

  await page.getByTestId('goto-forgot').click()
  await page.waitForURL('**/forgot-password')
  await input(page, 'forgot-email').fill(email)
  await page.getByTestId('forgot-submit').click()
  // Bestätigung ist bewusst neutral (keine User-Enumeration)
  await expect(page.getByTestId('forgot-sent')).toBeVisible()
})

test('Reset mit ungültigem Token zeigt Fehler', async ({ page }) => {
  await page.goto('/reset-password?token=ungueltig')
  await input(page, 'reset-password').fill('ganzNeuesPasswort9')
  await page.getByTestId('reset-submit').click()
  await expect(page.getByTestId('reset-error')).toBeVisible()
})

test('Reset-Seite ohne Token weist darauf hin', async ({ page }) => {
  await page.goto('/reset-password')
  await expect(page.getByTestId('reset-no-token')).toBeVisible()
})

test('Konto löschen: entfernt Konto, Login danach unmöglich', async ({ page }) => {
  const email = uniqueEmail('delete')
  await register(page, email)

  await page.getByRole('tab', { name: 'Einstellungen' }).click()
  await page.getByTestId('delete-account-button').click()
  // Bestätigungsdialog → destruktiven Button im Alert klicken
  await page.locator('ion-alert').getByRole('button', { name: 'Konto löschen' }).click()
  await page.waitForURL('**/login')

  // Login mit den gelöschten Daten schlägt fehl
  await input(page, 'login-email').fill(email)
  await input(page, 'login-password').fill(PASSWORD)
  await page.getByTestId('login-submit').click()
  await expect(page.getByTestId('login-error')).toContainText('E-Mail oder Passwort ist falsch')
})

test('Session überlebt einen Seiten-Reload', async ({ page }) => {
  const email = uniqueEmail('reload')
  await register(page, email)

  await page.reload()
  await expect(page).toHaveURL(/\/tabs\/dashboard/)
  await page.getByRole('tab', { name: 'Einstellungen' }).click()
  await expect(page.getByTestId('settings-email')).toHaveText(email)
})
