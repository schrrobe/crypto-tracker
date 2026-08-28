import { describe, expect, it } from 'vitest'
import { bankDetailsSchema, isValidIban } from '@crypto-tracker/shared'

describe('referral bank details validation', () => {
  it('normalisiert und akzeptiert eine gültige IBAN', () => {
    const parsed = bankDetailsSchema.parse({
      iban: 'DE89 3704 0044 0532 0130 00',
      bic: 'COBADEFFXXX',
      holder: 'Test User',
    })

    expect(parsed.iban).toBe('DE89370400440532013000')
    expect(isValidIban(parsed.iban)).toBe(true)
  })

  it('lehnt eine formal plausible IBAN mit falscher Prüfsumme ab', () => {
    const parsed = bankDetailsSchema.safeParse({
      iban: 'DE88 3704 0044 0532 0130 00',
      bic: 'COBADEFFXXX',
      holder: 'Test User',
    })

    expect(parsed.success).toBe(false)
  })
})
