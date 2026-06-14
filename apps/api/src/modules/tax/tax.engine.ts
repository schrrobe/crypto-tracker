import { Prisma } from '@prisma/client'
import type { TxType } from '@prisma/client'
import type { TaxRegime, TaxWarningDto } from '@crypto-tracker/shared'
import { TaxWarningCode } from '@crypto-tracker/shared'

// Reine Steuer-Engine — kein Prisma-Client, kein Express, kein I/O.
// Rechnet ausschließlich mit Prisma.Decimal (decimal.js), nie mit float.
//
// Rechtliche Grundlagen und dokumentierte Annahmen:
// - DE: §23 EStG (private Veräußerungsgeschäfte). FIFO pro Quelle/Wallet und
//   Asset (walletbezogene Betrachtung nach BMF-Schreiben v. 10.05.2022).
//   Verknüpfte Transfer-Paare (transferGroupId) ziehen die Kostenbasis samt
//   Anschaffungsdatum in die Ziel-Quelle um; die Mengendifferenz (Netzwerk-
//   gebühr) verlässt das System still — ihre Basis verfällt (konservativ).
//   Unverknüpfte Auszahlungen entfernen die Basis wie bisher (Warnung).
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
  sourceId: string
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
  // gesetzt = Teil eines verknüpften Transfer-Paars (WITHDRAWAL ↔ DEPOSIT)
  transferGroupId: string | null
  // gesetzt = Teil eines Krypto-zu-Krypto-Tauschs (SELL ↔ BUY) — nur AT relevant
  swapGroupId: string | null
}

export interface EngineDisposal {
  sourceId: string
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
  // null = Anschaffung unbekannt (z.B. umgezogener Oversell-Anteil)
  acquiredAt: Date | null
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

// Verknüpfte Paare werden normalisiert: das „eingehende"
// Leg (DEPOSIT bzw. BUY) darf nominell bis 24 h vor dem „ausgehenden" liegen
// (CSV-Tagesgranularität) — sein Sortierschlüssel wird auf den Out-Zeitpunkt
// angehoben, Tie-Break „Out zuerst". Gilt für Transfer-Paare (WITHDRAWAL↔DEPOSIT)
// und Swap-Paare (SELL↔BUY), damit das Out-Leg garantiert vorher verarbeitet wird.
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
  // Out-Legs (WITHDRAWAL/SELL) vor In-Legs (DEPOSIT/BUY) bei Gleichstand
  const legOrder = (tx: EngineTx): number =>
    tx.type === 'WITHDRAWAL' || (tx.type === 'SELL' && tx.swapGroupId !== null) ? 0 : 1
  return [...txs].sort((a, b) => sortKey(a) - sortKey(b) || legOrder(a) - legOrder(b))
}

// Übernimmt umgezogene Slices als Ziel-Lots, FIFO-getrimmt auf die Einzahlungs-
// menge: die Differenz (Netzwerkgebühr) sind die jüngsten verbrauchten Anteile,
// ihre Kostenbasis verfällt still (konservativ, kein Abzug). Danach wird die
// FIFO-Ordnung im Ziel nach Anschaffungsdatum wiederhergestellt — ein altes,
// umgezogenes Lot muss vor jüngeren Ziel-Lots verbraucht werden (null zuletzt).
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
      sourceId: tx.sourceId,
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
  // walletbezogenes FIFO: Lots je (Quelle, Asset)
  const lotsByWallet = new Map<string, Lot[]>()
  // umgezogene Slices verknüpfter Transfers, bis das Deposit-Leg sie abholt
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
            // verknüpfter Transfer: Kostenbasis + Anschaffungsdatum ziehen mit um
            pendingTransfers.delete(tx.transferGroupId)
            receiveTransferSlices(lots, moved, tx.quantity)
            break
          }
          // Withdrawal-Leg fehlt im Stream (defensiv) → wie unverlinkt behandeln
        }
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
        if (slices.some((s) => s.acquiredAt === null && s.costBasisEur.eq(ZERO))) {
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
      case 'WITHDRAWAL': {
        const slices = consumeFifo(lots, tx.quantity)
        if (tx.transferGroupId !== null) {
          // verknüpfter Transfer: Slices warten auf das Deposit-Leg — keine Warnung
          pendingTransfers.set(tx.transferGroupId, slices)
        } else {
          // kein steuerbarer Vorgang, aber die Kostenbasis verlässt die Verfolgung
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
  // verbleibende pendingTransfers (Deposit-Leg fehlt im Stream): Basis hat das
  // System verlassen — wie unverlinktes Withdrawal, bewusst ohne weitere Aktion

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
  // gestashte Kostenbasis je Swap-Group: SELL-Leg legt ab, BUY-Leg übernimmt
  const pendingSwaps = new Map<string, Decimal>()
  const allDisposals: EngineDisposal[] = []

  // Swaps erfordern Out-vor-In-Reihenfolge (SELL stasht, BUY übernimmt)
  for (const tx of chronologicalWithTransferOrder(txs)) {
    const altLots = altLotsByAsset.get(tx.assetId) ?? []
    altLotsByAsset.set(tx.assetId, altLots)
    const neuPool = neuPoolByAsset.get(tx.assetId) ?? { quantity: ZERO, totalCost: ZERO }
    neuPoolByAsset.set(tx.assetId, neuPool)

    switch (tx.type) {
      case 'BUY':
      case 'DEPOSIT': {
        // verknüpfter Transfer: bei globalen Pools genuin neutral → Leg überspringen
        // (Vereinfachung: die Netzwerkgebühr bleibt im Pool, Bestand minimal überzeichnet)
        if (tx.type === 'DEPOSIT' && tx.transferGroupId !== null) break
        // Swap-BUY (Asset B): übernimmt die Kostenbasis des getauschten A (§27b),
        // landet als Neuvermögen — unabhängig vom Tauschzeitpunkt
        if (tx.type === 'BUY' && tx.swapGroupId !== null) {
          const carried = pendingSwaps.get(tx.swapGroupId)
          // Fehlt das SELL-Leg im Stream, ist die übernommene Basis unbekannt (0) —
          // ohne Hinweis überzeichnet eine spätere Veräußerung von B den Gewinn.
          if (carried === undefined) warnings.add(TaxWarningCode.UNKNOWN_ACQUISITION_BASIS, tx.assetSymbol)
          pendingSwaps.delete(tx.swapGroupId)
          neuPool.quantity = neuPool.quantity.add(tx.quantity)
          neuPool.totalCost = neuPool.totalCost.add(carried ?? ZERO)
          break
        }
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
        // verknüpfter Transfer: Gegenstück zum übersprungenen Deposit-Leg
        if (tx.type === 'WITHDRAWAL' && tx.transferGroupId !== null) break
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

        // Swap-SELL (Asset A): steueraufgeschoben (§27b) — keine Veräußerung;
        // die verbrauchte Kostenbasis wandert auf das BUY-Leg (Asset B)
        if (tx.swapGroupId !== null) {
          const carried = [...altSlices, ...neuSlices].reduce((sum, s) => sum.add(s.costBasisEur), ZERO)
          pendingSwaps.set(tx.swapGroupId, carried)
          warnings.add(TaxWarningCode.SWAP_DEFERRED, tx.assetSymbol)
          // mehr getauscht als angeschafft → weitergereichte Basis ist zu niedrig
          if (oversold) warnings.add(TaxWarningCode.SOLD_MORE_THAN_ACQUIRED, tx.assetSymbol)
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

export interface HoldingCostBasis {
  quantity: Decimal
  costBasisEur: Decimal
}

// Kostenbasis der AKTUELL gehaltenen Menge je (Quelle, Asset) — für die
// unrealisierte PnL-Anzeige. Replay aller Transaktionen mit wallet-bezogenem FIFO
// (wie computeReportDE, ohne Jahr-/Gewinn-/Freigrenzen-Logik); am Ende die offenen
// Lots aggregieren. Key: `${sourceId}|${assetId}`.
export function computeHoldingsCostBasis(txs: EngineTx[]): Map<string, HoldingCostBasis> {
  const warnings = new WarningCollector() // verworfen — reine Kostenbasis
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
        lots.push({ acquiredAt: tx.timestamp, remaining: tx.quantity, costPerUnit: cost.div(tx.quantity) })
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
