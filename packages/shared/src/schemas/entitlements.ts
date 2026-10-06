import type { Plan } from './auth.schema'
import type { HistoryRange } from './portfolio.schema'

// Central definition of what Free vs. Pro is allowed to do — used by backend
// gating and by the frontend display (limits, locked features).

export const FREE_LIMITS = {
  portfolios: 2,
  sources: 5,
} as const

// Value-history ranges per plan. '1y' is Pro-exclusive.
export const FREE_HISTORY_RANGES: HistoryRange[] = ['24h', '7d', '30d']
export const PRO_HISTORY_RANGES: HistoryRange[] = ['24h', '7d', '30d', '1y']

// Pro-only features (shown in the paywall / gating keys).
export const PRO_FEATURES = ['tax', 'pnl', 'autoSync', 'history1y', 'unlimitedPortfolios', 'unlimitedSources'] as const
export type ProFeature = (typeof PRO_FEATURES)[number]

// Machine-readable payload of a 402 PLAN_UPGRADE_REQUIRED response. Lets the
// client show contextual paywall copy and a live usage counter. Defined here so
// the backend (AppError.upgradeRequired) and frontend share one contract.
export interface UpgradeRequiredDetails {
  feature: ProFeature
  limit?: number
  used?: number
}

export function isPro(plan: Plan): boolean {
  return plan === 'PRO'
}

export function historyRangesFor(plan: Plan): HistoryRange[] {
  return isPro(plan) ? PRO_HISTORY_RANGES : FREE_HISTORY_RANGES
}

// Visible movement history (statement lines) per plan. Everything is stored;
// the window is applied at query time, so an upgrade reveals older lines at once.
export const FREE_MOVEMENT_HISTORY_DAYS = 30
export const PRO_MOVEMENT_HISTORY_DAYS = 365

export function movementHistoryDaysFor(plan: Plan): number {
  return isPro(plan) ? PRO_MOVEMENT_HISTORY_DAYS : FREE_MOVEMENT_HISTORY_DAYS
}

export function canAddPortfolio(plan: Plan, current: number): boolean {
  return isPro(plan) || current < FREE_LIMITS.portfolios
}

export function canAddSource(plan: Plan, current: number): boolean {
  return isPro(plan) || current < FREE_LIMITS.sources
}
