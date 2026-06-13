# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: portfolios.spec.ts >> Multi-Portfolio: anlegen, wechseln, strikte Trennung der Bestände
- Location: tests/portfolios.spec.ts:4:1

# Error details

```
Error: locator.click: Error: strict mode violation: getByRole('button', { name: /Mein Portfolio/ }) resolved to 2 elements:
    1) <button type="button" id="action-sheet-button-15-0" class="action-sheet-button ion-activatable ion-focusable sc-ion-action-sheet-md">…</button> aka locator('#action-sheet-button-15-0')
    2) <button type="button" id="action-sheet-button-16-0" class="action-sheet-button ion-activatable ion-focusable sc-ion-action-sheet-md">…</button> aka locator('#action-sheet-button-16-0')

Call log:
  - waiting for getByRole('button', { name: /Mein Portfolio/ })

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e5]:
    - generic [ref=e8]:
      - banner [ref=e9]:
        - generic [ref=e11]:
          - button [ref=e14] [cursor=pointer]:
            - generic [ref=e15]:
              - img:
                - generic:
                  - img
          - button [ref=e21] [cursor=pointer]:
            - generic [ref=e22]:
              - img:
                - generic:
                  - img
      - main [ref=e23]:
        - generic [ref=e25]:
          - button [ref=e27] [cursor=pointer]:
            - generic [ref=e28]:
              - heading [level=3] [ref=e29]
              - heading [level=2] [ref=e30]
            - paragraph [ref=e32]: "Preise: noch nie · Tippen für USD"
          - generic [ref=e33]:
            - paragraph [ref=e34]: Noch keine Bestände.
            - generic [ref=e35]:
              - link [ref=e37] [cursor=pointer]:
                - /url: /tabs/sources?add=1
              - link [ref=e40] [cursor=pointer]:
                - /url: /tabs/sources?csv=1
              - link [ref=e43] [cursor=pointer]:
                - /url: /tabs/holdings?add=1
    - tablist [ref=e45]:
      - tab [selected] [ref=e47] [cursor=pointer]:
        - generic [ref=e48]:
          - img [ref=e49]:
            - img [ref=e51]
          - generic [ref=e56]: Dashboard
      - tab [ref=e58] [cursor=pointer]:
        - generic [ref=e59]:
          - img [ref=e60]:
            - img [ref=e62]
          - generic [ref=e66]: Bestände
      - tab [ref=e68] [cursor=pointer]:
        - generic [ref=e69]:
          - img [ref=e70]:
            - img [ref=e72]
          - generic [ref=e75]: Markt
      - tab [ref=e77] [cursor=pointer]:
        - generic [ref=e78]:
          - img [ref=e79]:
            - img [ref=e81]
          - generic [ref=e83]: Quellen
      - tab [ref=e85] [cursor=pointer]:
        - generic [ref=e86]:
          - img [ref=e87]:
            - img [ref=e89]
          - generic [ref=e91]: Einstellungen
  - dialog "Portfolio wechseln" [ref=e92]:
    - generic:
      - generic:
        - generic [ref=e93]:
          - generic [ref=e94]: Portfolio wechseln
          - button "Mein Portfolio" [ref=e95] [cursor=pointer]:
            - generic: Mein Portfolio
          - button "✓ Eltern" [ref=e96] [cursor=pointer]:
            - generic: ✓ Eltern
          - button "Portfolios verwalten…" [ref=e97] [cursor=pointer]:
            - generic: Portfolios verwalten…
        - button "Abbrechen" [ref=e99] [cursor=pointer]:
          - generic: Abbrechen
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | import { input, register, uniqueEmail } from './helpers'
  3  | 
  4  | test('Multi-Portfolio: anlegen, wechseln, strikte Trennung der Bestände', async ({ page }) => {
  5  |   await register(page, uniqueEmail('portfolios'))
  6  | 
  7  |   // BTC-Bestand im Default-Portfolio
  8  |   await page.getByRole('tab', { name: 'Bestände' }).click()
  9  |   await page.getByTestId('add-holding').click()
  10 |   await page.getByTestId('asset-search').locator('input').fill('bitcoin')
  11 |   await page.getByTestId('asset-option-BTC').click()
  12 |   await input(page, 'holding-quantity').fill('1')
  13 |   await page.getByTestId('holding-save').click()
  14 |   await expect(page.getByTestId('holding-BTC')).toBeVisible()
  15 | 
  16 |   // zweites Portfolio anlegen
  17 |   await page.getByRole('tab', { name: 'Einstellungen' }).click()
  18 |   await page.getByTestId('portfolio-create').click()
  19 |   await page.locator('ion-alert input').fill('Eltern')
  20 |   await page.getByRole('button', { name: 'Speichern' }).click()
  21 |   await expect(page.getByTestId('portfolio-Eltern')).toBeVisible()
  22 | 
  23 |   // Switcher erscheint (vorher unsichtbar) → zu Eltern wechseln
  24 |   await page.locator('[data-testid="portfolio-switcher"]:visible').click()
  25 |   await page.getByRole('button', { name: 'Eltern' }).click()
  26 | 
  27 |   // Eltern-Portfolio ist leer
  28 |   await page.getByRole('tab', { name: 'Bestände' }).click()
  29 |   await expect(page.getByTestId('holdings-empty')).toBeVisible()
  30 |   await page.getByRole('tab', { name: 'Dashboard' }).click()
  31 |   await expect(page.getByTestId('total-value')).toHaveText(/0,00\s€/u)
  32 | 
  33 |   // zurück zum Default → BTC wieder da
  34 |   await page.locator('[data-testid="portfolio-switcher"]:visible').click()
> 35 |   await page.getByRole('button', { name: /Mein Portfolio/ }).click()
     |                                                              ^ Error: locator.click: Error: strict mode violation: getByRole('button', { name: /Mein Portfolio/ }) resolved to 2 elements:
  36 |   await page.getByRole('tab', { name: 'Bestände' }).click()
  37 |   await expect(page.getByTestId('holding-BTC')).toBeVisible()
  38 | })
  39 | 
  40 | test('Portfolio-Löschregeln: letztes und nicht-leeres Portfolio blockiert', async ({ page }) => {
  41 |   await register(page, uniqueEmail('pf-rules'))
  42 |   await page.getByRole('tab', { name: 'Einstellungen' }).click()
  43 | 
  44 |   // letztes Portfolio löschen → Fehlertext
  45 |   await page.getByTestId('portfolio-delete-Mein Portfolio').click()
  46 |   await page.getByRole('button', { name: 'Löschen' }).click()
  47 |   await expect(page.getByTestId('portfolio-error')).toContainText('letzte Portfolio')
  48 | })
  49 | 
```