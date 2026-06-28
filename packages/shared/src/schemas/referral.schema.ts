// Referral program: both sides earn free Pro-time (no cash, no bank details).
export interface InvitedAccountDto {
  emailMasked: string
  joinedAt: string
  isPro: boolean
}

export interface ReferralDto {
  code: string
  link: string
  invitedCount: number
  // Invited users who converted to paid Pro (each earned the referrer a reward).
  proConversions: number
  // Total Pro-days this user has earned from the program (non-voided rewards).
  earnedProDays: number
  // Per-referral reward size in days — for UI copy ("Lade einen Freund ein → 30 Tage Pro").
  rewardDays: number
  invited: InvitedAccountDto[]
}
