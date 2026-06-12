import { Prisma } from '@prisma/client'
import type { TxType } from '@prisma/client'
import type { TaxRegime, TaxWarningDto } from '@crypto-tracker/shared'
import { TaxWarningCode } from '@crypto-tracker/shared'

// Reine Steuer-Engine — kein Prisma-Client, kein Express, kein I/O.
// Rechnet ausschließlich mit Prisma.Decimal (decimal.js), nie mit float.
//
// Rechtliche Grundlagen und dokumentierte Annahmen:
// - DE: §23 EStG (private Veräußerungsgeschäfte). FIFO pro Asset, GLOBAL über
//   alle Quellen — das BMF-Schreiben v. 10.05.2022 erlaubt wallet-bezogene
//   Betrachtung, aber ohne modellierte Transfers zwischen Quellen wäre
//   per-Quelle-FIFO falsch. Bewusste Vereinfachung, im Report ausgewiesen.
// - DE: Haltefrist > 1 Jahr → steuerfrei (§23 Abs. 1 Nr. 2). Exakt 1 Jahr ist
//   noch steuerpflichtig. Freigrenze (kein Freibetrag!) 600 € bis VZ 2023,
//   1.000 € ab VZ 2024: wird sie erreicht, ist der GESAMTE Gewinn steuerpflichtig.
// - AT: Stichtag 1.3.2021 (§27b EStG / ÖkoStRefG). Altvermögen (Anschaffung
//   davor): alte Spekulationsfrist 1 Jahr (§31 EStG aF), Freigrenze 440 €.
//   Neuvermögen: 27,5 % Sondersteuersatz, keine Haltefrist, Kostenbasis =
//   gleitender Durchschnittspreis pro Asset (KryptowährungsVO).
// - AT: bei gemischtem Alt-/Neubestand wird Altvermögen zuerst verbraucht
//   (Annahme; die VO erlaubt Zuordnung durch den Steuerpflichtigen).

type Decimal = Prisma.Decimal
const ZERO = new Prisma.Decimal(0)

// Stichtag Alt-/Neuvermögen Österreich
const AT_ALT_CUTOFF = new Date(Date.UTC(2021, 2, 1))

export type EnginePriceSource = 'ORIGINAL' | 'BACKFILLED' | 'MISSING'

export interface EngineTx {
  id: string
  assetId: string
  assetSymbol: string
  assetName: string
  type: TxType
  quantity: Decimal
  // EUR-Kurs pro Einheit nach Anreicherung/Backfill; null = nicht ermittelbar
  priceEur: Decimal | null
  feeEur: Decimal | null
  timestamp: Date
  priceSource: EnginePriceSource
}

export interface EngineDisposal {
  assetSymbol: string
  assetName: string
  // null = Anschaffung unbekannt (Oversell/Durchschnittspool) → konservativ behandelt
  acquiredAt: Date | null
  disposedAt: Date
  quantity: Decimal
  costBasisEur: Decimal
  proceedsEur: Decimal
  gainEur: Decimal
  taxable: boolean
  regime: TaxRegime
  // Kurs-Qualität der Veräußerung; MISSING-Zeilen fließen NICHT in die Summen
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
  // nur DE: sonstige Einkünfte aus Staking (§22 Nr. 3 EStG) bei Zufluss
  stakingIncomeEur?: Decimal
  stakingThresholdEur?: Decimal
  stakingTaxableEur?: Decimal
}

export interface EngineReport {
  disposals: EngineDisposal[]
  totals: EngineTotals
  warnings: TaxWarningDto[]
}

// Haltefrist-Vergleichsdatum; JS-Date rollt 29.02. auf 01.03. — deterministisch ok
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

// > 1 Jahr gehalten? Exakt 1 Jahr zählt noch als steuerpflichtig.
function heldOverOneYear(acquiredAt: Date, disposedAt: Date): boolean {
  return disposedAt.getTime() > addOneYear(acquiredAt).getTime()
}

// Sammelt Warnungen aggregiert pro (Code, Asset)
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
  acquiredAt: Date
  remaining: Decimal
  costPerUnit: Decimal
}

interface ConsumedSlice {
  // null = ungedeckter Anteil (mehr veräußert als angeschafft) oder Durchschnittspool
  acquiredAt: Date | null
  quantity: Decimal
  costBasisEur: Decimal
}

// Verbraucht FIFO aus den Lots; ungedeckte Restmenge wird als Slice mit
// acquiredAt=null und Basis 0 zurückgegeben (steuerlich konservativ).
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

// Anschaffungskosten eines Erwerbs: Menge × Kurs + Gebühr (Anschaffungsnebenkosten).
// Ohne Kurs: Basis 0 + Warnung (konservativ — voller Erlös wird später Gewinn).
function acquisitionCost(tx: EngineTx, warnings: WarningCollector): Decimal {
  if (tx.priceEur === null) {
    warnings.add(TaxWarningCode.UNKNOWN_ACQUISITION_BASIS, tx.assetSymbol)
    return ZERO
  }
  return tx.quantity.mul(tx.priceEur).add(tx.feeEur ?? ZERO)
}

// Veräußerungserlös: Menge × Kurs − Gebühr (Veräußerungskosten)
function disposalProceeds(tx: EngineTx): Decimal {
  if (tx.priceEur === null) return ZERO
  return tx.quantity.mul(tx.priceEur).sub(tx.feeEur ?? ZERO)
}

function inYear(date: Date, year: number): boolean {
  return date.getUTCFullYear() === year
}

function chronological(txs: EngineTx[]): EngineTx[] {
  return [...txs].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
}

// Erzeugt aus den verbrauchten Slices die Veräußerungszeilen; der Erlös wird
// mengenproportional verteilt. Keine Warnung-Logik — die liegt beim Aufrufer.
function buildDisposals(
  tx: EngineTx,
  slices: ConsumedSlice[],
  regime: TaxRegime,
  taxableFor: (slice: ConsumedSlice) => boolean,
): EngineDisposal[] {
  const proceeds = disposalProceeds(tx)
  return slices.map((slice) => {
    const sliceProceeds = proceeds.mul(slice.quantity).div(tx.quantity)
    return {
      assetSymbol: tx.assetSymbol,
      assetName: tx.assetName,
      acquiredAt: slice.acquiredAt,
      disposedAt: tx.timestamp,
      quantity: slice.quantity,
      costBasisEur: slice.costBasisEur,
      proceedsEur: sliceProceeds,
      gainEur: sliceProceeds.sub(slice.costBasisEur),
      taxable: taxableFor(slice),
      regime,
      priceQuality: tx.priceSource,
    }
  })
}

function sumGains(disposals: EngineDisposal[]): Decimal {
  return disposals.reduce((sum, d) => sum.add(d.gainEur), ZERO)
}

// ——————————————————————————— Deutschland ———————————————————————————

// Freigrenze §23 Abs. 3 EStG: 600 € bis VZ 2023, 1.000 € ab VZ 2024
function deThreshold(year: number): Decimal {
  return new Prisma.Decimal(year >= 2024 ? 1000 : 600)
}

// Freigrenze §22 Nr. 3 EStG für sonstige Einkünfte (Staking-Zuflüsse)
const DE_STAKING_THRESHOLD = new Prisma.Decimal(256)

export function computeReportDE(txs: EngineTx[], year: number): EngineReport {
  const warnings = new WarningCollector()
  const lotsByAsset = new Map<string, Lot[]>()
  const allDisposals: EngineDisposal[] = []
  let stakingIncome = ZERO

  for (const tx of chronological(txs)) {
    const lots = lotsByAsset.get(tx.assetId) ?? []
    lotsByAsset.set(tx.assetId, lots)

    switch (tx.type) {
      case 'BUY':
      case 'DEPOSIT': {
        const cost = acquisitionCost(tx, warnings)
        lots.push({ acquiredAt: tx.timestamp, remaining: tx.quantity, costPerUnit: cost.div(tx.quantity) })
        break
      }
      case 'STAKING_REWARD': {
        // §22 Nr. 3 EStG: Zufluss zum Marktwert = sonstige Einkünfte;
        // Anschaffungskosten = Zuflusswert, Haltefrist läuft ab Zufluss
        const cost = acquisitionCost(tx, warnings)
        lots.push({ acquiredAt: tx.timestamp, remaining: tx.quantity, costPerUnit: cost.div(tx.quantity) })
        if (inYear(tx.timestamp, year) && tx.priceEur !== null) {
          stakingIncome = stakingIncome.add(tx.quantity.mul(tx.priceEur))
        }
        break
      }
      case 'SELL': {
        const slices = consumeFifo(lots, tx.quantity)
        if (tx.priceEur === null) warnings.add(TaxWarningCode.MISSING_DISPOSAL_PRICE, tx.assetSymbol)
        if (slices.some((s) => s.acquiredAt === null)) {
          warnings.add(TaxWarningCode.SOLD_MORE_THAN_ACQUIRED, tx.assetSymbol)
        }
        allDisposals.push(
          ...buildDisposals(tx, slices, 'DE_PRIVATE_SALE', (slice) =>
            // unbekannte Anschaffung → wie ≤ 1 Jahr gehalten (steuerpflichtig)
            slice.acquiredAt === null ? true : !heldOverOneYear(slice.acquiredAt, tx.timestamp),
          ),
        )
        break
      }
      case 'WITHDRAWAL':
        // kein steuerbarer Vorgang, aber die Kostenbasis verlässt die Verfolgung
        consumeFifo(lots, tx.quantity)
        warnings.add(TaxWarningCode.WITHDRAWAL_REMOVED_LOTS, tx.assetSymbol)
        break
      case 'TRANSFER':
      case 'OTHER':
        warnings.add(TaxWarningCode.TRANSFERS_IGNORED, tx.assetSymbol)
        break
    }
  }

  const disposals = allDisposals.filter((d) => inYear(d.disposedAt, year))
  // Zeilen ohne Veräußerungskurs sind unvollständig — sie würden die Summen
  // als künstlicher Verlust verfälschen und bleiben deshalb außen vor
  const complete = disposals.filter((d) => d.priceQuality !== 'MISSING')

  const totalGain = sumGains(complete)
  const taxFreeGain = sumGains(complete.filter((d) => !d.taxable))
  const taxableNet = sumGains(complete.filter((d) => d.taxable))

  const threshold = deThreshold(year)
  // Freigrenze: positiver Gewinn unterhalb der Grenze → 0; ab der Grenze voll steuerpflichtig.
  // Netto-Verlust bleibt als Verlust stehen (Verlustverrechnung nur innerhalb §23).
  const underThreshold = taxableNet.gt(0) && taxableNet.lt(threshold)
  // Staking: eigene Freigrenze 256 € (§22 Nr. 3 Satz 2 EStG), gleiche Semantik
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

// ——————————————————————————— Österreich ———————————————————————————

// Neuvermögen als gleitender Durchschnittspreis-Pool pro Asset
interface NeuPool {
  quantity: Decimal
  totalCost: Decimal
}

// Freigrenze §31 Abs. 3 EStG aF — gilt nur für Altvermögen-Spekulationsgeschäfte
const AT_ALT_THRESHOLD = new Prisma.Decimal(440)

export function computeReportAT(txs: EngineTx[], year: number): EngineReport {
  const warnings = new WarningCollector()
  const altLotsByAsset = new Map<string, Lot[]>()
  const neuPoolByAsset = new Map<string, NeuPool>()
  const allDisposals: EngineDisposal[] = []

  for (const tx of chronological(txs)) {
    const altLots = altLotsByAsset.get(tx.assetId) ?? []
    altLotsByAsset.set(tx.assetId, altLots)
    const neuPool = neuPoolByAsset.get(tx.assetId) ?? { quantity: ZERO, totalCost: ZERO }
    neuPoolByAsset.set(tx.assetId, neuPool)

    switch (tx.type) {
      case 'BUY':
      case 'DEPOSIT': {
        const cost = acquisitionCost(tx, warnings)
        if (tx.timestamp.getTime() < AT_ALT_CUTOFF.getTime()) {
          // Altvermögen: einzelne Lots, alte Spekulationsfrist gilt
          altLots.push({ acquiredAt: tx.timestamp, remaining: tx.quantity, costPerUnit: cost.div(tx.quantity) })
        } else {
          // Neuvermögen: gleitender Durchschnittspreis (KryptowährungsVO)
          neuPool.quantity = neuPool.quantity.add(tx.quantity)
          neuPool.totalCost = neuPool.totalCost.add(cost)
        }
        break
      }
      case 'STAKING_REWARD': {
        // §27b Abs. 2 EStG: kein Zufluss-Einkommen, Anschaffungskosten 0 —
        // Besteuerung des vollen Werts erst bei der Veräußerung
        if (tx.timestamp.getTime() < AT_ALT_CUTOFF.getTime()) {
          altLots.push({ acquiredAt: tx.timestamp, remaining: tx.quantity, costPerUnit: ZERO })
        } else {
          neuPool.quantity = neuPool.quantity.add(tx.quantity)
          // totalCost unverändert: Kosten 0
        }
        break
      }
      case 'SELL':
      case 'WITHDRAWAL': {
        // Altvermögen zuerst verbrauchen (dokumentierte Annahme), dann Durchschnittspool
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
          // ungedeckter Anteil: Anschaffung unbekannt → Neuvermögen unterstellt (konservativ)
          neuSlices.push({ acquiredAt: null, quantity: open, costBasisEur: ZERO })
        }

        if (tx.type === 'WITHDRAWAL') {
          warnings.add(TaxWarningCode.WITHDRAWAL_REMOVED_LOTS, tx.assetSymbol)
          break
        }

        if (tx.priceEur === null) warnings.add(TaxWarningCode.MISSING_DISPOSAL_PRICE, tx.assetSymbol)
        if (oversold) warnings.add(TaxWarningCode.SOLD_MORE_THAN_ACQUIRED, tx.assetSymbol)

        allDisposals.push(
          ...buildDisposals(tx, altSlices, 'AT_ALTVERMOEGEN', (slice) =>
            slice.acquiredAt === null ? true : !heldOverOneYear(slice.acquiredAt, tx.timestamp),
          ),
          // Neuvermögen ist unabhängig von der Haltedauer immer steuerpflichtig (27,5 %)
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

  // Freigrenze 440 € nur auf Altvermögen-Spekulationsgewinne
  const underThreshold = altTaxableNet.gt(0) && altTaxableNet.lt(AT_ALT_THRESHOLD)
  const altAfterThreshold = underThreshold ? ZERO : altTaxableNet

  return {
    disposals,
    totals: {
      totalGainEur: totalGain,
      taxFreeGainEur: taxFreeGain,
      taxableGainEur: altTaxableNet.add(neuNet),
      thresholdEur: AT_ALT_THRESHOLD,
      thresholdApplied: altTaxableNet.gte(AT_ALT_THRESHOLD),
      taxableAfterThresholdEur: altAfterThreshold.add(neuNet),
      atNeuvermoegenGainEur: neuNet,
    },
    warnings: warnings.list(),
  }
}
