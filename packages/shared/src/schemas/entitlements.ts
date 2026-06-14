import type { Plan } from './auth.schema'
import type { HistoryRange } from './portfolio.schema'

// Zentrale Definition, was Free vs. Pro darf — genutzt vom Backend-Gating und
// von der Frontend-Anzeige (Limits, gesperrte Funktionen).

export const FREE_LIMITS = {
  portfolios: 2,
  sources: 5,
} as const

// Wertverlauf-Zeiträume je Plan. '1y' ist Pro-exklusiv.
export const FREE_HISTORY_RANGES: HistoryRange[] = ['24h', '7d', '30d']
export const PRO_HISTORY_RANGES: HistoryRange[] = ['24h', '7d', '30d', '1y']

// Reine Pro-Funktionen (Anzeige in der Paywall / Gating-Schlüssel).
export const PRO_FEATURES = ['tax', 'pnl', 'autoSync', 'history1y', 'unlimitedPortfolios', 'unlimitedSources'] as const
export type ProFeature = (typeof PRO_FEATURES)[number]

export function isPro(plan: Plan): boolean {
  return plan === 'PRO'
}

export function historyRangesFor(plan: Plan): HistoryRange[] {
  return isPro(plan) ? PRO_HISTORY_RANGES : FREE_HISTORY_RANGES
}

export function canAddPortfolio(plan: Plan, current: number): boolean {
  return isPro(plan) || current < FREE_LIMITS.portfolios
}

export function canAddSource(plan: Plan, current: number): boolean {
  return isPro(plan) || current < FREE_LIMITS.sources
}
