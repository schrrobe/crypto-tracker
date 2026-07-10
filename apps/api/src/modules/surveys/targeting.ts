import type { Prisma, Plan } from '@prisma/client'

// Survey targeting: a survey reaches a user when the user matches every non-empty
// targeting axis. An empty array on an axis means "no restriction on that axis", so a
// survey with no targeting at all reaches every non-suspended user (broadcast).

export type SurveyTarget = { targetPlans: Plan[]; targetCurrencies: string[] }
export type TargetableUser = { plan: Plan; baseCurrency: string }

export function userMatchesTarget(user: TargetableUser, survey: SurveyTarget): boolean {
  if (survey.targetPlans.length > 0 && !survey.targetPlans.includes(user.plan)) return false
  if (
    survey.targetCurrencies.length > 0 &&
    !survey.targetCurrencies.includes(user.baseCurrency.toUpperCase())
  ) {
    return false
  }
  return true
}

// Prisma `where` for the set of users a survey targets: non-suspended, matching every
// non-empty axis. This is the denominator for response-rate analytics and the audience
// for reminders. Currencies are stored upper-cased on both sides (see shared schema and
// User.baseCurrency), so a direct `in` match is correct.
export function eligibleUserWhere(survey: SurveyTarget): Prisma.UserWhereInput {
  return {
    suspendedAt: null,
    ...(survey.targetPlans.length > 0 ? { plan: { in: survey.targetPlans } } : {}),
    ...(survey.targetCurrencies.length > 0
      ? { baseCurrency: { in: survey.targetCurrencies } }
      : {}),
  }
}
