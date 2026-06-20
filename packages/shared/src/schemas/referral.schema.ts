import { z } from 'zod'

// Bank details for manual payout. IBAN is normalized (spaces stripped, upper-cased)
// then format-checked (country + check digits + up to 30 alphanumerics). BIC optional.
// Note: this is a structural check, not a mod-97 checksum validation.
export const bankDetailsSchema = z.object({
  iban: z
    .string()
    .transform((s) => s.replace(/\s+/g, '').toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/, 'Ungültige IBAN')),
  bic: z
    .string()
    .transform((s) => s.replace(/\s+/g, '').toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/, 'Ungültige BIC')),
  holder: z.string().trim().min(1).max(100),
})
export type BankDetailsInput = z.infer<typeof bankDetailsSchema>

export interface InvitedAccountDto {
  emailMasked: string
  joinedAt: string
  isPro: boolean
}

// Earnings are tracked per currency — commissions in different currencies must
// never be summed together (each Stripe invoice keeps its own currency).
export interface ReferralEarningsDto {
  owedCents: number
  paidCents: number
  currency: string
}

export interface ReferralDto {
  code: string
  link: string
  invitedCount: number
  earnings: ReferralEarningsDto[]
  invited: InvitedAccountDto[]
}

// Bank details as returned to the owner: never the full IBAN, only a preview.
export interface ReferralBankDto {
  holder: string
  bic: string
  ibanPreview: string
}
