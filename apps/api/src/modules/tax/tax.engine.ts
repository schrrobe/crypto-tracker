import { Prisma } from '@prisma/client'
import type { TxType } from '@prisma/client'
import type { TaxRegime, TaxWarningDto } from '@crypto-tracker/shared'
import { TaxWarningCode } from '@crypto-tracker/shared'

// Pure tax engine — no Prisma client, no Express, no I/O.
// Computes exclusively with Prisma.Decimal (decimal.js), never with float.
//
// Legal basis and documented assumptions:
// - DE: §23 EStG (private disposal transactions). FIFO per source/wallet and
//   asset (wallet-based view per the BMF letter of 10.05.2022).
//   Linked transfer pairs (transferGroupId) move the cost basis together with
//   the acquisition date into the target source; the quantity difference
//   (network fee) leaves the system silently — its basis lapses (conservative).
//   Unlinked withdrawals remove the basis as before (warning).
// - DE: holding period > 1 year → tax-free (§23 Abs. 1 Nr. 2). Exactly 1 year is
//   still taxable. Freigrenze (an exemption limit, not an allowance!) 600 € up to
//   assessment period 2023, 1,000 € from 2024 on: once reached, the ENTIRE gain is taxable.
// - AT: cutoff date 1.3.2021 (§27b EStG / ÖkoStRefG). Altvermögen (pre-cutoff
//   holdings, acquired before): old speculation period of 1 year (§31 EStG aF),
//   Freigrenze 440 €.
//   Neuvermögen (post-cutoff holdings): 27.5 % special tax rate, no holding period,
//   cost basis = moving average price per asset (KryptowährungsVO).
// - AT: with mixed Altvermögen/Neuvermögen, Altvermögen is consumed first
//   (assumption; the regulation lets the taxpayer choose the allocation).

type Decimal = Prisma.Decimal
const ZERO = new Prisma.Decimal(0)

export type EnginePriceSource = 'ORIGINAL' | 'BACKFILLED' | 'MISSING'

export interface EngineTx {
  id: string
  sourceId: string
  assetId: string
  assetSymbol: string
  assetName: string
  type: TxType
  quantity: Decimal
  // EUR price per unit after enrichment/backfill; null = not determinable
  priceEur: Decimal | null
  feeEur: Decimal | null
  timestamp: Date
  priceSource: EnginePriceSource
  // set = part of a linked transfer pair (WITHDRAWAL ↔ DEPOSIT)
  transferGroupId: string | null
  // set = part of a crypto-to-crypto swap (SELL ↔ BUY) — only relevant for AT
  swapGroupId: string | null
}

export interface EngineDisposal {
  sourceId: string
  assetSymbol: string
  assetName: string
  // null = acquisition unknown (oversell/average pool) → handled conservatively
  acquiredAt: Date | null
  disposedAt: Date
  quantity: Decimal
  costBasisEur: Decimal
  proceedsEur: Decimal
  gainEur: Decimal
  taxable: boolean
  regime: TaxRegime
  // price quality of the disposal; MISSING rows do NOT flow into the totals
  priceQuality: EnginePriceSource
}

export interface EngineTotals {
  totalGainEur: Decimal
  taxFreeGainEur: Decimal
  taxableGainEur: Decimal
  thresholdEur: Decimal | null
  thresholdApplied: boolean
  taxableAfterThresholdEur: Decimal
  atNeuvermoegenGainEur?: Decimal
  // AT only: estimated tax on the Neuvermögen pool at the 27.5 % flat rate (§27a EStG)
  atNeuvermoegenTaxEur?: Decimal
  // DE only: other income from staking (§22 Nr. 3 EStG) at the time of inflow
  stakingIncomeEur?: Decimal
  stakingThresholdEur?: Decimal
  stakingTaxableEur?: Decimal
}

export interface EngineReport {
  disposals: EngineDisposal[]
  totals: EngineTotals
  warnings: TaxWarningDto[]
}

// Holding-period comparison date; JS Date rolls 29.02. to 01.03. — deterministic, ok
function addOneYear(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear() + 1,
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
    ),
  )
}

// Held > 1 year? Exactly 1 year still counts as taxable.
function heldOverOneYear(acquiredAt: Date, disposedAt: Date): boolean {
  return disposedAt.getTime() > addOneYear(acquiredAt).getTime()
}

// Collects warnings aggregated per (code, asset)
class WarningCollector {
  private counts = new Map<string, TaxWarningDto>()

  add(code: TaxWarningDto['code'], assetSymbol?: string): void {
    const key = `${code}|${assetSymbol ?? ''}`
    const existing = this.counts.get(key)
    if (existing) existing.count = (existing.count ?? 1) + 1
    else this.counts.set(key, { code, ...(assetSymbol ? { assetSymbol } : {}), count: 1 })
  }

  list(): TaxWarningDto[] {
    return [...this.counts.values()]
  }
}

interface Lot {
  // null = acquisition unknown (e.g. a moved oversell portion)
  acquiredAt: Date | null
  remaining: Decimal
  costPerUnit: Decimal
}

interface ConsumedSlice {
  // null = uncovered portion (disposed more than acquired) or average pool
  acquiredAt: Date | null
  quantity: Decimal
  costBasisEur: Decimal
}

// Consumes FIFO from the lots; an uncovered remaining quantity is returned as a
// slice with acquiredAt=null and basis 0 (conservative for tax purposes).
function consumeFifo(lots: Lot[], quantity: Decimal): ConsumedSlice[] {
  const slices: ConsumedSlice[] = []
  let open = quantity
  while (open.gt(0) && lots.length > 0) {
    const lot = lots[0] as Lot
    const take = Prisma.Decimal.min(lot.remaining, open)
    slices.push({ acquiredAt: lot.acquiredAt, quantity: take, costBasisEur: take.mul(lot.costPerUnit) })
    lot.remaining = lot.remaining.sub(take)
    open = open.sub(take)
    if (lot.remaining.lte(0)) lots.shift()
  }
  if (open.gt(0)) {
    slices.push({ acquiredAt: null, quantity: open, costBasisEur: ZERO })
  }
  return slices
}

// Per-unit cost. Defensive: a 0/negative quantity would throw on division.
// The API blocks these (quantityString > 0), but imports/sync write Transaction
// rows directly — guard so a single bad row can't crash the whole report.
function perUnitCost(cost: Decimal, quantity: Decimal): Decimal {
  return quantity.gt(0) ? cost.div(quantity) : ZERO
}

// Acquisition cost of a purchase: quantity × price + fee (incidental acquisition costs).
// Without a price: basis 0 + warning (conservative — the full proceeds later become gain).
function acquisitionCost(tx: EngineTx, warnings: WarningCollector): Decimal {
  if (tx.priceEur === null) {
    warnings.add(TaxWarningCode.UNKNOWN_ACQUISITION_BASIS, tx.assetSymbol)
    return ZERO
  }
  return tx.quantity.mul(tx.priceEur).add(tx.feeEur ?? ZERO)
}

// Disposal proceeds: quantity × price − fee (disposal costs)
function disposalProceeds(tx: EngineTx): Decimal {
  if (tx.priceEur === null) return ZERO
  return tx.quantity.mul(tx.priceEur).sub(tx.feeEur ?? ZERO)
}

// Tax year is the civil calendar year in the taxpayer's timezone. DE and AT both
// use Central European Time (Europe/Berlin and Europe/Vienna share offset + DST
// rules year-round), so a disposal at 31.12. 23:30 UTC counts for the NEXT year
// (00:30 local). Bucketing on UTC would mis-assign transactions in the ~1–2 h
// window around New Year to the wrong assessment period.
const TAX_TZ = 'Europe/Berlin'
const taxYearFormatter = new Intl.DateTimeFormat('en-US', { timeZone: TAX_TZ, year: 'numeric' })

function inYear(date: Date, year: number): boolean {
  return Number(taxYearFormatter.format(date)) === year
}

// AT Altvermögen/Neuvermögen cutoff is the CIVIL date 1.3.2021 in Austrian local
// time (CET — same offset/DST as Europe/Berlin). Comparing on UTC midnight would
// misclassify acquisitions in the ~1 h window around the cutoff (e.g. 28.2. 23:30
// UTC = 1.3. 00:30 local → Neuvermögen, not Altvermögen) — the same bug class the
// inYear fix removed for year bucketing. Lexicographic ISO-date (YYYY-MM-DD) compare.
const taxCivilDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TAX_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const AT_ALT_CUTOFF_CIVIL = '2021-03-01'
function isAtAltvermoegen(acquiredAt: Date): boolean {
  return taxCivilDateFormatter.format(acquiredAt) < AT_ALT_CUTOFF_CIVIL
}

// Linked pairs are normalized: the "incoming"
// leg (DEPOSIT or BUY) may nominally sit up to 24 h before the "outgoing" one
// (CSV day-level granularity) — its sort key is raised to the out timestamp,
// tie-break "out first". Applies to transfer pairs (WITHDRAWAL↔DEPOSIT) and swap
// pairs (SELL↔BUY), so the out leg is guaranteed to be processed first.
function chronologicalWithTransferOrder(txs: EngineTx[]): EngineTx[] {
  const outTsByTransfer = new Map<string, number>()
  const outTsBySwap = new Map<string, number>()
  for (const tx of txs) {
    if (tx.type === 'WITHDRAWAL' && tx.transferGroupId !== null) {
      outTsByTransfer.set(tx.transferGroupId, tx.timestamp.getTime())
    }
    if (tx.type === 'SELL' && tx.swapGroupId !== null) {
      outTsBySwap.set(tx.swapGroupId, tx.timestamp.getTime())
    }
  }
  const sortKey = (tx: EngineTx): number => {
    const own = tx.timestamp.getTime()
    if (tx.type === 'DEPOSIT' && tx.transferGroupId !== null) {
      const outTs = outTsByTransfer.get(tx.transferGroupId)
      if (outTs !== undefined && outTs > own) return outTs
    }
    if (tx.type === 'BUY' && tx.swapGroupId !== null) {
      const outTs = outTsBySwap.get(tx.swapGroupId)
      if (outTs !== undefined && outTs > own) return outTs
    }
    return own
  }
  // Out legs (WITHDRAWAL/SELL) before in legs (DEPOSIT/BUY) on a tie
  const legOrder = (tx: EngineTx): number =>
    tx.type === 'WITHDRAWAL' || (tx.type === 'SELL' && tx.swapGroupId !== null) ? 0 : 1
  return [...txs].sort((a, b) => sortKey(a) - sortKey(b) || legOrder(a) - legOrder(b))
}

// Takes moved slices as target lots, FIFO-trimmed to the deposit quantity:
// the difference (network fee) is the most recently consumed portions, whose
// cost basis lapses silently (conservative, no deduction). Afterwards the
// FIFO order in the target is restored by acquisition date — an old, moved lot
// must be consumed before newer target lots (null last).
function receiveTransferSlices(lots: Lot[], moved: ConsumedSlice[], quantity: Decimal): void {
  let open = quantity
  for (const slice of moved) {
    if (open.lte(0)) break
    const take = Prisma.Decimal.min(slice.quantity, open)
    const costPerUnit = slice.quantity.gt(0) ? slice.costBasisEur.div(slice.quantity) : ZERO
    lots.push({ acquiredAt: slice.acquiredAt, remaining: take, costPerUnit })
    open = open.sub(take)
  }
  lots.sort(
    (a, b) =>
      (a.acquiredAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (b.acquiredAt?.getTime() ?? Number.MAX_SAFE_INTEGER),
  )
}

// Builds the disposal rows from the consumed slices; the proceeds are
// distributed proportionally to quantity. No warning logic — that is the caller's.
//
// Money is rounded to whole cents PER ROW here, and the totals are summed from
// these rounded rows (see sumGains in the callers). The cent is the legal unit,
// so rounding here keeps the displayed/exported per-disposal rows reconciling
// exactly with the totals — full-precision totals vs per-row toFixed(2) would
// otherwise drift by 1–2 cents. Tradeoff: the Freigrenze comparison now runs on
// the cent-rounded sum (sub-cent shift at the exact threshold edge — acceptable).
function buildDisposals(
  tx: EngineTx,
  slices: ConsumedSlice[],
  regime: TaxRegime,
  taxableFor: (slice: ConsumedSlice) => boolean,
): EngineDisposal[] {
  const proceeds = disposalProceeds(tx)
  return slices.map((slice) => {
    const sliceProceeds = proceeds.mul(slice.quantity).div(tx.quantity).toDecimalPlaces(2)
    const costBasisEur = slice.costBasisEur.toDecimalPlaces(2)
    return {
      sourceId: tx.sourceId,
      assetSymbol: tx.assetSymbol,
      assetName: tx.assetName,
      acquiredAt: slice.acquiredAt,
      disposedAt: tx.timestamp,
      quantity: slice.quantity,
      costBasisEur,
      proceedsEur: sliceProceeds,
      gainEur: sliceProceeds.sub(costBasisEur),
      taxable: taxableFor(slice),
      regime,
      priceQuality: tx.priceSource,
    }
  })
}

function sumGains(disposals: EngineDisposal[]): Decimal {
  return disposals.reduce((sum, d) => sum.add(d.gainEur), ZERO)
}

// ——————————————————————————— Germany ———————————————————————————

// Freigrenze §23 Abs. 3 EStG: 600 € up to assessment period 2023, 1,000 € from 2024 on
function deThreshold(year: number): Decimal {
  return new Prisma.Decimal(year >= 2024 ? 1000 : 600)
}

// Freigrenze §22 Nr. 3 EStG for other income (staking inflows)
const DE_STAKING_THRESHOLD = new Prisma.Decimal(256)

export function computeReportDE(txs: EngineTx[], year: number): EngineReport {
  const warnings = new WarningCollector()
  // wallet-based FIFO: lots per (source, asset)
  const lotsByWallet = new Map<string, Lot[]>()
  // moved slices of linked transfers, until the deposit leg picks them up
  const pendingTransfers = new Map<string, ConsumedSlice[]>()
  const allDisposals: EngineDisposal[] = []
  let stakingIncome = ZERO

  for (const tx of chronologicalWithTransferOrder(txs)) {
    const walletKey = `${tx.sourceId}|${tx.assetId}`
    const lots = lotsByWallet.get(walletKey) ?? []
    lotsByWallet.set(walletKey, lots)

    switch (tx.type) {
      case 'BUY':
      case 'DEPOSIT': {
        if (tx.type === 'DEPOSIT' && tx.transferGroupId !== null) {
          const moved = pendingTransfers.get(tx.transferGroupId)
          if (moved) {
            // linked transfer: cost basis + acquisition date move along
            pendingTransfers.delete(tx.transferGroupId)
            receiveTransferSlices(lots, moved, tx.quantity)
            break
          }
          // withdrawal leg missing from the stream (defensive) → treat as unlinked
        }
        const cost = acquisitionCost(tx, warnings)
        lots.push({ acquiredAt: tx.timestamp, remaining: tx.quantity, costPerUnit: perUnitCost(cost, tx.quantity) })
        break
      }
      case 'STAKING_REWARD': {
        // §22 Nr. 3 EStG: inflow at market value = other income;
        // acquisition cost = inflow value, holding period starts at inflow
        const cost = acquisitionCost(tx, warnings)
        lots.push({ acquiredAt: tx.timestamp, remaining: tx.quantity, costPerUnit: perUnitCost(cost, tx.quantity) })
        if (inYear(tx.timestamp, year)) {
          if (tx.priceEur !== null) {
            stakingIncome = stakingIncome.add(tx.quantity.mul(tx.priceEur))
          } else {
            // Reward counted at 0 income → §22 Nr. 3 income line is understated; signal it
            warnings.add(TaxWarningCode.STAKING_INCOME_PRICE_MISSING, tx.assetSymbol)
          }
        }
        break
      }
      case 'SELL': {
        const slices = consumeFifo(lots, tx.quantity)
        if (tx.priceEur === null) warnings.add(TaxWarningCode.MISSING_DISPOSAL_PRICE, tx.assetSymbol)
        if (slices.some((s) => s.acquiredAt === null && s.costBasisEur.eq(ZERO))) {
          warnings.add(TaxWarningCode.SOLD_MORE_THAN_ACQUIRED, tx.assetSymbol)
        }
        allDisposals.push(
          ...buildDisposals(tx, slices, 'DE_PRIVATE_SALE', (slice) =>
            // unknown acquisition → treated as held ≤ 1 year (taxable)
            slice.acquiredAt === null ? true : !heldOverOneYear(slice.acquiredAt, tx.timestamp),
          ),
        )
        break
      }
      case 'WITHDRAWAL': {
        const slices = consumeFifo(lots, tx.quantity)
        if (tx.transferGroupId !== null) {
          // linked transfer: slices wait for the deposit leg — no warning
          pendingTransfers.set(tx.transferGroupId, slices)
        } else {
          // not a taxable event, but the cost basis leaves the tracking
          warnings.add(TaxWarningCode.WITHDRAWAL_REMOVED_LOTS, tx.assetSymbol)
        }
        break
      }
      case 'TRANSFER':
      case 'OTHER':
        warnings.add(TaxWarningCode.TRANSFERS_IGNORED, tx.assetSymbol)
        break
    }
  }
  // remaining pendingTransfers (deposit leg missing from the stream): basis has
  // left the system — like an unlinked withdrawal, deliberately no further action

  const disposals = allDisposals.filter((d) => inYear(d.disposedAt, year))
  // rows without a disposal price are incomplete — they would distort the totals
  // as an artificial loss and are therefore left out
  const complete = disposals.filter((d) => d.priceQuality !== 'MISSING')

  const totalGain = sumGains(complete)
  const taxFreeGain = sumGains(complete.filter((d) => !d.taxable))
  const taxableNet = sumGains(complete.filter((d) => d.taxable))

  const threshold = deThreshold(year)
  // Freigrenze: positive gain below the limit → 0; at or above the limit fully taxable.
  // A net loss remains as a loss (loss offsetting only within §23).
  const underThreshold = taxableNet.gt(0) && taxableNet.lt(threshold)
  // Staking: own Freigrenze 256 € (§22 Nr. 3 Satz 2 EStG), same semantics
  const stakingUnderThreshold = stakingIncome.gt(0) && stakingIncome.lt(DE_STAKING_THRESHOLD)

  return {
    disposals,
    totals: {
      totalGainEur: totalGain,
      taxFreeGainEur: taxFreeGain,
      taxableGainEur: taxableNet,
      thresholdEur: threshold,
      thresholdApplied: taxableNet.gte(threshold),
      taxableAfterThresholdEur: underThreshold ? ZERO : taxableNet,
      stakingIncomeEur: stakingIncome,
      stakingThresholdEur: DE_STAKING_THRESHOLD,
      stakingTaxableEur: stakingUnderThreshold ? ZERO : stakingIncome,
    },
    warnings: warnings.list(),
  }
}

// ——————————————————————————— Austria ———————————————————————————

// Neuvermögen (post-cutoff holdings) as a moving average price pool per asset
interface NeuPool {
  quantity: Decimal
  totalCost: Decimal
}

// Freigrenze §31 Abs. 3 EStG aF — applies only to Altvermögen speculation transactions
const AT_ALT_THRESHOLD = new Prisma.Decimal(440)
// Besonderer Steuersatz §27a Abs. 1 EStG on Neuvermögen capital gains
const AT_NEU_TAX_RATE = new Prisma.Decimal('0.275')

export function computeReportAT(txs: EngineTx[], year: number): EngineReport {
  const warnings = new WarningCollector()
  const altLotsByAsset = new Map<string, Lot[]>()
  const neuPoolByAsset = new Map<string, NeuPool>()
  // stashed cost basis per swap group: the SELL leg deposits, the BUY leg takes over
  const pendingSwaps = new Map<string, Decimal>()
  const allDisposals: EngineDisposal[] = []

  // swaps require out-before-in order (SELL stashes, BUY takes over)
  for (const tx of chronologicalWithTransferOrder(txs)) {
    const altLots = altLotsByAsset.get(tx.assetId) ?? []
    altLotsByAsset.set(tx.assetId, altLots)
    const neuPool = neuPoolByAsset.get(tx.assetId) ?? { quantity: ZERO, totalCost: ZERO }
    neuPoolByAsset.set(tx.assetId, neuPool)

    switch (tx.type) {
      case 'BUY':
      case 'DEPOSIT': {
        // linked transfer: genuinely neutral with global pools → skip the leg
        // (simplification: the network fee stays in the pool, holdings slightly overstated)
        if (tx.type === 'DEPOSIT' && tx.transferGroupId !== null) break
        // swap BUY (asset B): takes over the cost basis of the swapped A (§27b),
        // lands as Neuvermögen — independent of the swap timestamp
        if (tx.type === 'BUY' && tx.swapGroupId !== null) {
          const carried = pendingSwaps.get(tx.swapGroupId)
          // if the SELL leg is missing from the stream, the carried basis is unknown (0) —
          // without a hint a later disposal of B would overstate the gain.
          if (carried === undefined) warnings.add(TaxWarningCode.UNKNOWN_ACQUISITION_BASIS, tx.assetSymbol)
          pendingSwaps.delete(tx.swapGroupId)
          neuPool.quantity = neuPool.quantity.add(tx.quantity)
          neuPool.totalCost = neuPool.totalCost.add(carried ?? ZERO)
          break
        }
        const cost = acquisitionCost(tx, warnings)
        if (isAtAltvermoegen(tx.timestamp)) {
          // Altvermögen: individual lots, the old speculation period applies
          altLots.push({ acquiredAt: tx.timestamp, remaining: tx.quantity, costPerUnit: perUnitCost(cost, tx.quantity) })
        } else {
          // Neuvermögen: moving average price (KryptowährungsVO)
          neuPool.quantity = neuPool.quantity.add(tx.quantity)
          neuPool.totalCost = neuPool.totalCost.add(cost)
        }
        break
      }
      case 'STAKING_REWARD': {
        // §27b Abs. 2 EStG: no inflow income, acquisition cost 0 —
        // the full value is taxed only at disposal
        if (isAtAltvermoegen(tx.timestamp)) {
          altLots.push({ acquiredAt: tx.timestamp, remaining: tx.quantity, costPerUnit: ZERO })
        } else {
          neuPool.quantity = neuPool.quantity.add(tx.quantity)
          // totalCost unchanged: cost 0
        }
        break
      }
      case 'SELL':
      case 'WITHDRAWAL': {
        // linked transfer: counterpart to the skipped deposit leg
        if (tx.type === 'WITHDRAWAL' && tx.transferGroupId !== null) break
        // consume Altvermögen first (documented assumption), then the average pool
        const altSlices: ConsumedSlice[] = []
        const neuSlices: ConsumedSlice[] = []
        let open = tx.quantity

        const altAvailable = altLots.reduce((sum, lot) => sum.add(lot.remaining), ZERO)
        if (altAvailable.gt(0)) {
          const fromAlt = Prisma.Decimal.min(open, altAvailable)
          altSlices.push(...consumeFifo(altLots, fromAlt))
          open = open.sub(fromAlt)
        }
        if (open.gt(0) && neuPool.quantity.gt(0)) {
          const fromNeu = Prisma.Decimal.min(open, neuPool.quantity)
          const avgCost = neuPool.totalCost.div(neuPool.quantity)
          neuSlices.push({ acquiredAt: null, quantity: fromNeu, costBasisEur: fromNeu.mul(avgCost) })
          neuPool.totalCost = neuPool.totalCost.sub(fromNeu.mul(avgCost))
          neuPool.quantity = neuPool.quantity.sub(fromNeu)
          open = open.sub(fromNeu)
        }
        const oversold = open.gt(0)
        if (oversold) {
          // uncovered portion: acquisition unknown → assumed Neuvermögen (conservative)
          neuSlices.push({ acquiredAt: null, quantity: open, costBasisEur: ZERO })
        }

        if (tx.type === 'WITHDRAWAL') {
          warnings.add(TaxWarningCode.WITHDRAWAL_REMOVED_LOTS, tx.assetSymbol)
          break
        }

        // swap SELL (asset A): tax-deferred (§27b) — not a disposal;
        // the consumed cost basis moves to the BUY leg (asset B)
        if (tx.swapGroupId !== null) {
          const carried = [...altSlices, ...neuSlices].reduce((sum, s) => sum.add(s.costBasisEur), ZERO)
          pendingSwaps.set(tx.swapGroupId, carried)
          warnings.add(TaxWarningCode.SWAP_DEFERRED, tx.assetSymbol)
          // swapped more than acquired → the carried-forward basis is too low
          if (oversold) warnings.add(TaxWarningCode.SOLD_MORE_THAN_ACQUIRED, tx.assetSymbol)
          break
        }

        if (tx.priceEur === null) warnings.add(TaxWarningCode.MISSING_DISPOSAL_PRICE, tx.assetSymbol)
        if (oversold) warnings.add(TaxWarningCode.SOLD_MORE_THAN_ACQUIRED, tx.assetSymbol)

        allDisposals.push(
          ...buildDisposals(tx, altSlices, 'AT_ALTVERMOEGEN', (slice) =>
            slice.acquiredAt === null ? true : !heldOverOneYear(slice.acquiredAt, tx.timestamp),
          ),
          // Neuvermögen is always taxable regardless of holding period (27.5 %)
          ...buildDisposals(tx, neuSlices, 'AT_NEUVERMOEGEN', () => true),
        )
        break
      }
      case 'TRANSFER':
      case 'OTHER':
        warnings.add(TaxWarningCode.TRANSFERS_IGNORED, tx.assetSymbol)
        break
    }
  }

  const disposals = allDisposals.filter((d) => inYear(d.disposedAt, year))
  const complete = disposals.filter((d) => d.priceQuality !== 'MISSING')

  const altComplete = complete.filter((d) => d.regime === 'AT_ALTVERMOEGEN')
  const neuNet = sumGains(complete.filter((d) => d.regime === 'AT_NEUVERMOEGEN'))

  const totalGain = sumGains(complete)
  const taxFreeGain = sumGains(altComplete.filter((d) => !d.taxable))
  const altTaxableNet = sumGains(altComplete.filter((d) => d.taxable))

  // Freigrenze 440 € only on Altvermögen speculation gains
  const underThreshold = altTaxableNet.gt(0) && altTaxableNet.lt(AT_ALT_THRESHOLD)
  const altAfterThreshold = underThreshold ? ZERO : altTaxableNet

  // Altvermögen speculation (§31 aF, progressive rate) and Neuvermögen (§27b,
  // 27.5 % flat) are distinct income categories — a net loss in one must NOT
  // reduce the taxable gain of the other. Clamp each bucket to >= 0 for the
  // taxable figures (a net loss is simply not taxable; loss carry-forward is
  // out of scope for V1). atNeuvermoegenGainEur stays raw so a Neu loss is visible.
  const neuTaxable = Prisma.Decimal.max(neuNet, ZERO)
  const altTaxable = Prisma.Decimal.max(altAfterThreshold, ZERO)

  return {
    disposals,
    totals: {
      totalGainEur: totalGain,
      taxFreeGainEur: taxFreeGain,
      taxableGainEur: Prisma.Decimal.max(altTaxableNet, ZERO).add(neuTaxable),
      thresholdEur: AT_ALT_THRESHOLD,
      thresholdApplied: altTaxableNet.gte(AT_ALT_THRESHOLD),
      taxableAfterThresholdEur: altTaxable.add(neuTaxable),
      atNeuvermoegenGainEur: neuNet,
      atNeuvermoegenTaxEur: neuTaxable.mul(AT_NEU_TAX_RATE),
    },
    warnings: warnings.list(),
  }
}

export interface HoldingCostBasis {
  quantity: Decimal
  costBasisEur: Decimal
}

// Cost basis of the CURRENTLY held quantity per (source, asset) — for the
// unrealized PnL display. Replays all transactions with wallet-based FIFO
// (like computeReportDE, without year/gain/Freigrenze logic); at the end the open
// lots are aggregated. Key: `${sourceId}|${assetId}`.
export function computeHoldingsCostBasis(txs: EngineTx[]): Map<string, HoldingCostBasis> {
  const warnings = new WarningCollector() // discarded — cost basis only
  const lotsByWallet = new Map<string, Lot[]>()
  const pendingTransfers = new Map<string, ConsumedSlice[]>()

  for (const tx of chronologicalWithTransferOrder(txs)) {
    const walletKey = `${tx.sourceId}|${tx.assetId}`
    const lots = lotsByWallet.get(walletKey) ?? []
    lotsByWallet.set(walletKey, lots)

    switch (tx.type) {
      case 'BUY':
      case 'DEPOSIT':
      case 'STAKING_REWARD': {
        if (tx.type === 'DEPOSIT' && tx.transferGroupId !== null) {
          const moved = pendingTransfers.get(tx.transferGroupId)
          if (moved) {
            pendingTransfers.delete(tx.transferGroupId)
            receiveTransferSlices(lots, moved, tx.quantity)
            break
          }
        }
        const cost = acquisitionCost(tx, warnings)
        lots.push({ acquiredAt: tx.timestamp, remaining: tx.quantity, costPerUnit: perUnitCost(cost, tx.quantity) })
        break
      }
      case 'SELL': {
        consumeFifo(lots, tx.quantity)
        break
      }
      case 'WITHDRAWAL': {
        const slices = consumeFifo(lots, tx.quantity)
        if (tx.transferGroupId !== null) pendingTransfers.set(tx.transferGroupId, slices)
        break
      }
      case 'TRANSFER':
      case 'OTHER':
        break
    }
  }

  const result = new Map<string, HoldingCostBasis>()
  for (const [key, lots] of lotsByWallet) {
    let quantity = ZERO
    let costBasisEur = ZERO
    for (const lot of lots) {
      quantity = quantity.add(lot.remaining)
      costBasisEur = costBasisEur.add(lot.remaining.mul(lot.costPerUnit))
    }
    if (quantity.gt(0)) result.set(key, { quantity, costBasisEur })
  }
  return result
}
