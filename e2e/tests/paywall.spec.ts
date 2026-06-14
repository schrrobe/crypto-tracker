import { expect, test } from '@playwright/test'
import { register, uniqueEmail } from './helpers'

test('Paywall: Free sperrt Steuerreport, Dev-Toggle Pro hebt das Gate auf', async ({ page }) => {
  await register(page, uniqueEmail('paywall'))
  await page.getByRole('tab', { name: 'Einstellungen' }).click()

  // Free plan shown
  await expect(page.getByTestId('settings-plan')).toHaveText('Free')

  // Tax entry → paywall (no navigation)
  await page.getByTestId('open-tax-report').click()
  await expect(page.getByTestId('paywall-upgrade')).toBeVisible()
  await page.getByTestId('paywall-close').click()
  await expect(page.getByTestId('paywall-upgrade')).toBeHidden()

  // Dev toggle to Pro
  await page
    .locator('[data-testid="dev-plan-toggle"] ion-segment-button', { hasText: 'Pro' })
    .click()
  await expect(page.getByTestId('settings-plan')).toHaveText('Pro')

  // Now the tax entry opens the report
  await page.getByTestId('open-tax-report').click()
  await expect(page).toHaveURL(/tax-report/)
})
