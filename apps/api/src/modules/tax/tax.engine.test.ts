import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import type { TxType } from '@prisma/client'
import {
  computeHoldingsCostBasis,
  computeReportAT,
  computeReportDE,
  type EngineTx,
} from './tax.engine'

const dec = (v: string | number) => new Prisma.Decimal(v)

let counter = 0
function tx(input: {
  type: TxType
  qty: string | number
  price?: string | number | null
  fee?: string | number
  ts: string
  symbol?: string
  missing?: boolean
  source?: string
  transferGroup?: string
  swapGroup?: string
}): EngineTx {
  counter += 1
  const priceEur = input.price === null || input.price === undefined ? null : dec(input.price)
  return {
    id: `tx-${counter}`,
    sourceId: input.source ?? 'src-1',
    assetId: input.symbol ?? 'BTC',
    assetSymbol: input.symbol ?? 'BTC',
    assetName: input.symbol ?? 'Bitcoin',
    type: input.type,
    quantity: dec(input.qty),
    priceEur,
    feeEur: input.fee === undefined ? null : dec(input.fee),
    timestamp: new Date(input.ts),
    priceSource: input.missing ? 'MISSING' : priceEur === null ? 'MISSING' : 'ORIGINAL',
    transferGroupId: input.transferGroup ?? null,
    swapGroupId: input.swapGroup ?? null,
  }
}

function warningCodes(report: { warnings: Array<{ code: string }> }): string[] {
  return report.warnings.map((w) => w.code)
}

describe('Tax Engine — Deutschland (§23 EStG)', () => {
  it('FIFO: ältestes Lot wird zuerst verbraucht', () => {
    const report = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 10000, ts: '2023-01-01T00:00:00Z' }),
        tx({ type: 'BUY', qty: 1, price: 20000, ts: '2023-06-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 30000, ts: '2023-07-01T00:00:00Z' }),
      ],
      2023,
    )
    expect(report.disposals).toHaveLength(1)
    expect(report.disposals[0]?.costBasisEur.toString()).toBe('10000')
    expect(report.disposals[0]?.gainEur.toString()).toBe('20000')
    expect(report.disposals[0]?.taxable).toBe(true)
  })

  it('partieller Verbrauch: ein SELL erzeugt eine Zeile pro Lot-Anteil', () => {
    const report = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 10000, ts: '2022-01-01T00:00:00Z' }),
        tx({ type: 'BUY', qty: 1, price: 20000, ts: '2024-01-10T00:00:00Z' }),
        tx({ type: 'SELL', qty: '1.5', price: 30000, ts: '2024-06-01T00:00:00Z' }),
      ],
      2024,
    )
    expect(report.disposals).toHaveLength(2)
    const [old, recent] = report.disposals
    // 2022 lot: held > 1 year → tax-free
    expect(old?.taxable).toBe(false)
    expect(old?.gainEur.toString()).toBe('20000')
    // 2024 lot: taxable
    expect(recent?.taxable).toBe(true)
    expect(recent?.gainEur.toString()).toBe('5000')

    expect(report.totals.totalGainEur.toString()).toBe('25000')
    expect(report.totals.taxFreeGainEur.toString()).toBe('20000')
    expect(report.totals.taxableGainEur.toString()).toBe('5000')
    expect(report.totals.thresholdApplied).toBe(true)
    expect(report.totals.taxableAfterThresholdEur.toString()).toBe('5000')
  })

  it('Haltefrist: exakt 1 Jahr ist steuerpflichtig, 1 Jahr + 1 Tag steuerfrei', () => {
    const buy = tx({ type: 'BUY', qty: 1, price: 100, ts: '2023-05-10T10:00:00Z' })
    const exactly = computeReportDE(
      [buy, tx({ type: 'SELL', qty: 1, price: 200, ts: '2024-05-10T10:00:00Z' })],
      2024,
    )
    expect(exactly.disposals[0]?.taxable).toBe(true)

    const oneDayMore = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 100, ts: '2023-05-10T10:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 200, ts: '2024-05-11T10:00:01Z' }),
      ],
      2024,
    )
    expect(oneDayMore.disposals[0]?.taxable).toBe(false)
  })

  it('Haltefrist über Schaltjahr: Kauf am 29.02. rollt auf 01.03.', () => {
    const stillTaxable = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 100, ts: '2024-02-29T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 200, ts: '2025-02-28T00:00:00Z' }),
      ],
      2025,
    )
    expect(stillTaxable.disposals[0]?.taxable).toBe(true)

    const free = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 100, ts: '2024-02-29T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 200, ts: '2025-03-02T00:00:00Z' }),
      ],
      2025,
    )
    expect(free.disposals[0]?.taxable).toBe(false)
  })

  it('Freigrenze 600 € (bis 2023): 599 → 0, ab 600 voll steuerpflichtig', () => {
    const under = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 1000, ts: '2023-02-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 1599, ts: '2023-06-01T00:00:00Z' }),
      ],
      2023,
    )
    expect(under.totals.thresholdEur?.toString()).toBe('600')
    expect(under.totals.thresholdApplied).toBe(false)
    expect(under.totals.taxableAfterThresholdEur.toString()).toBe('0')

    const at = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 1000, ts: '2023-02-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 1600, ts: '2023-06-01T00:00:00Z' }),
      ],
      2023,
    )
    expect(at.totals.thresholdApplied).toBe(true)
    expect(at.totals.taxableAfterThresholdEur.toString()).toBe('600')
  })

  it('Freigrenze 1.000 € (ab 2024)', () => {
    const under = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 1000, ts: '2024-02-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 1999, ts: '2024-06-01T00:00:00Z' }),
      ],
      2024,
    )
    expect(under.totals.thresholdEur?.toString()).toBe('1000')
    expect(under.totals.taxableAfterThresholdEur.toString()).toBe('0')
  })

  it('Verluste werden innerhalb §23 verrechnet', () => {
    const report = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 1000, ts: '2024-01-01T00:00:00Z', symbol: 'BTC' }),
        tx({ type: 'SELL', qty: 1, price: 1500, ts: '2024-03-01T00:00:00Z', symbol: 'BTC' }),
        tx({ type: 'BUY', qty: 1, price: 1000, ts: '2024-01-01T00:00:00Z', symbol: 'ETH' }),
        tx({ type: 'SELL', qty: 1, price: 800, ts: '2024-03-01T00:00:00Z', symbol: 'ETH' }),
      ],
      2024,
    )
    // +500 − 200 = 300 < 1000 → Freigrenze not reached
    expect(report.totals.taxableGainEur.toString()).toBe('300')
    expect(report.totals.taxableAfterThresholdEur.toString()).toBe('0')
  })

  it('Netto-Verlust bleibt als Verlust stehen', () => {
    const report = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 1000, ts: '2024-01-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 400, ts: '2024-03-01T00:00:00Z' }),
      ],
      2024,
    )
    expect(report.totals.taxableGainEur.toString()).toBe('-600')
    expect(report.totals.thresholdApplied).toBe(false)
    expect(report.totals.taxableAfterThresholdEur.toString()).toBe('-600')
  })

  it('Gebühren erhöhen die Anschaffungskosten und mindern den Erlös', () => {
    const report = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 100, fee: 10, ts: '2024-01-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 200, fee: 5, ts: '2024-03-01T00:00:00Z' }),
      ],
      2024,
    )
    expect(report.disposals[0]?.costBasisEur.toString()).toBe('110')
    expect(report.disposals[0]?.proceedsEur.toString()).toBe('195')
    expect(report.disposals[0]?.gainEur.toString()).toBe('85')
  })

  it('Oversell: ungedeckter Anteil mit Basis 0, steuerpflichtig, Warnung', () => {
    const report = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 100, ts: '2024-01-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 2, price: 150, ts: '2024-03-01T00:00:00Z' }),
      ],
      2024,
    )
    expect(report.disposals).toHaveLength(2)
    const uncovered = report.disposals.find((d) => d.acquiredAt === null)
    expect(uncovered?.costBasisEur.toString()).toBe('0')
    expect(uncovered?.proceedsEur.toString()).toBe('150')
    expect(uncovered?.taxable).toBe(true)
    expect(warningCodes(report)).toContain('SOLD_MORE_THAN_ACQUIRED')
  })

  it('DEPOSIT ohne Kurs: Lot mit Basis 0 + Warnung', () => {
    const report = computeReportDE(
      [
        tx({ type: 'DEPOSIT', qty: 1, price: null, ts: '2024-01-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 500, ts: '2024-03-01T00:00:00Z' }),
      ],
      2024,
    )
    expect(warningCodes(report)).toContain('UNKNOWN_ACQUISITION_BASIS')
    expect(report.disposals[0]?.costBasisEur.toString()).toBe('0')
    expect(report.disposals[0]?.gainEur.toString()).toBe('500')
  })

  it('WITHDRAWAL entfernt Lots ohne steuerbaren Vorgang', () => {
    const report = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 5000, ts: '2020-01-01T00:00:00Z' }),
        tx({ type: 'WITHDRAWAL', qty: 1, ts: '2020-06-01T00:00:00Z' }),
        tx({ type: 'BUY', qty: 1, price: 20000, ts: '2024-01-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 30000, ts: '2024-06-01T00:00:00Z' }),
      ],
      2024,
    )
    // the 2020 lot is gone — the 2024 lot is the one sold
    expect(report.disposals).toHaveLength(1)
    expect(report.disposals[0]?.costBasisEur.toString()).toBe('20000')
    expect(report.disposals[0]?.taxable).toBe(true)
    expect(warningCodes(report)).toContain('WITHDRAWAL_REMOVED_LOTS')
  })

  it('TRANSFER/OTHER werden ignoriert (mit Hinweis)', () => {
    const report = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 100, ts: '2024-01-01T00:00:00Z' }),
        tx({ type: 'TRANSFER', qty: 1, ts: '2024-02-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 200, ts: '2024-03-01T00:00:00Z' }),
      ],
      2024,
    )
    // TRANSFER did not change the balance
    expect(report.disposals[0]?.costBasisEur.toString()).toBe('100')
    expect(warningCodes(report)).toContain('TRANSFERS_IGNORED')
  })

  it('mehrjährige Historie: Lots aus Vorjahren tragen, Report filtert aufs Jahr', () => {
    const txs = [
      tx({ type: 'BUY', qty: 1, price: 1000, ts: '2021-05-01T00:00:00Z' }),
      tx({ type: 'SELL', qty: 1, price: 60000, ts: '2025-02-01T00:00:00Z' }),
    ]
    const y2025 = computeReportDE(txs, 2025)
    expect(y2025.disposals).toHaveLength(1)
    expect(y2025.disposals[0]?.taxable).toBe(false) // > 1 year

    const y2024 = computeReportDE(txs, 2024)
    expect(y2024.disposals).toHaveLength(0)
    expect(y2024.totals.totalGainEur.toString()).toBe('0')
  })

  it('SELL ohne Kurs: Zeile als MISSING gelistet, aber nicht in den Summen', () => {
    const report = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 1000, ts: '2024-01-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: null, ts: '2024-03-01T00:00:00Z' }),
      ],
      2024,
    )
    expect(report.disposals).toHaveLength(1)
    expect(report.disposals[0]?.priceQuality).toBe('MISSING')
    expect(warningCodes(report)).toContain('MISSING_DISPOSAL_PRICE')
    // no artificial loss in the totals
    expect(report.totals.totalGainEur.toString()).toBe('0')
    expect(report.totals.taxableGainEur.toString()).toBe('0')
  })

  it('leerer Input ergibt leeren Report', () => {
    const report = computeReportDE([], 2024)
    expect(report.disposals).toHaveLength(0)
    expect(report.totals.totalGainEur.toString()).toBe('0')
    expect(report.warnings).toHaveLength(0)
  })

  it('wallet-FIFO: SELL auf Quelle B trifft nicht die Lots von Quelle A', () => {
    const report = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 100, ts: '2024-01-01T00:00:00Z', source: 'A' }),
        tx({ type: 'SELL', qty: 1, price: 200, ts: '2024-03-01T00:00:00Z', source: 'B' }),
        // proof: A is untouched — a sale on A uses the A lot
        tx({ type: 'SELL', qty: 1, price: 300, ts: '2024-06-01T00:00:00Z', source: 'A' }),
      ],
      2024,
    )
    const onB = report.disposals.find((d) => d.sourceId === 'B')
    const onA = report.disposals.find((d) => d.sourceId === 'A')
    // B has no lots → oversell with basis 0
    expect(onB?.costBasisEur.toString()).toBe('0')
    expect(onB?.acquiredAt).toBeNull()
    // A sells its own lot with basis 100
    expect(onA?.costBasisEur.toString()).toBe('100')
    expect(warningCodes(report)).toContain('SOLD_MORE_THAN_ACQUIRED')
  })

  it('verknüpfter Transfer: Kostenbasis und Haltefrist ziehen mit um', () => {
    const report = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 1000, ts: '2020-05-01T00:00:00Z', source: 'A' }),
        tx({ type: 'WITHDRAWAL', qty: 1, ts: '2023-02-01T00:00:00Z', source: 'A', transferGroup: 'g1' }),
        tx({ type: 'DEPOSIT', qty: 1, ts: '2023-02-01T01:00:00Z', source: 'B', transferGroup: 'g1' }),
        tx({ type: 'SELL', qty: 1, price: 50000, ts: '2024-06-01T00:00:00Z', source: 'B' }),
      ],
      2024,
    )
    expect(report.disposals).toHaveLength(1)
    // 2020 acquisition is preserved → > 1 year → tax-free
    expect(report.disposals[0]?.costBasisEur.toString()).toBe('1000')
    expect(report.disposals[0]?.taxable).toBe(false)
    // no transfer-related warnings
    expect(warningCodes(report)).not.toContain('WITHDRAWAL_REMOVED_LOTS')
    expect(warningCodes(report)).not.toContain('UNKNOWN_ACQUISITION_BASIS')
  })

  it('Transfer mit Netzwerkgebühr: Differenz verfällt still, älteste Anteile bleiben', () => {
    const report = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 1000, ts: '2022-01-01T00:00:00Z', source: 'A' }),
        tx({ type: 'WITHDRAWAL', qty: 1, ts: '2023-01-01T00:00:00Z', source: 'A', transferGroup: 'g1' }),
        tx({ type: 'DEPOSIT', qty: '0.995', ts: '2023-01-01T01:00:00Z', source: 'B', transferGroup: 'g1' }),
        tx({ type: 'SELL', qty: '0.995', price: 2000, ts: '2023-06-01T00:00:00Z', source: 'B' }),
      ],
      2023,
    )
    expect(report.disposals).toHaveLength(1)
    // basis pro rata: 0.995 × 1000 = 995
    expect(report.disposals[0]?.costBasisEur.toString()).toBe('995')
    expect(report.disposals[0]?.quantity.toString()).toBe('0.995')
  })

  it('Transfer: umgezogenes altes Lot wird im Ziel zuerst verbraucht (FIFO)', () => {
    const report = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 100, ts: '2022-06-01T00:00:00Z', source: 'B' }),
        tx({ type: 'BUY', qty: 1, price: 1000, ts: '2020-01-01T00:00:00Z', source: 'A' }),
        tx({ type: 'WITHDRAWAL', qty: 1, ts: '2023-01-01T00:00:00Z', source: 'A', transferGroup: 'g1' }),
        tx({ type: 'DEPOSIT', qty: 1, ts: '2023-01-01T01:00:00Z', source: 'B', transferGroup: 'g1' }),
        tx({ type: 'SELL', qty: 1, price: 5000, ts: '2024-01-01T00:00:00Z', source: 'B' }),
      ],
      2024,
    )
    // the 2020 lot (basis 1000) is sold, not the 2022 B lot
    expect(report.disposals).toHaveLength(1)
    expect(report.disposals[0]?.costBasisEur.toString()).toBe('1000')
    expect(report.disposals[0]?.taxable).toBe(false)
  })

  it('Transfer-Toleranz: Deposit nominell vor Withdrawal wird normalisiert', () => {
    const report = computeReportDE(
      [
        tx({ type: 'BUY', qty: 1, price: 100, ts: '2022-01-01T00:00:00Z', source: 'A' }),
        // CSV day-level granularity: deposit 6 h "before" the withdrawal
        tx({ type: 'DEPOSIT', qty: 1, ts: '2023-01-01T00:00:00Z', source: 'B', transferGroup: 'g1' }),
        tx({ type: 'WITHDRAWAL', qty: 1, ts: '2023-01-01T06:00:00Z', source: 'A', transferGroup: 'g1' }),
        tx({ type: 'SELL', qty: 1, price: 500, ts: '2024-06-01T00:00:00Z', source: 'B' }),
      ],
      2024,
    )
    expect(report.disposals[0]?.costBasisEur.toString()).toBe('100')
    expect(warningCodes(report)).not.toContain('UNKNOWN_ACQUISITION_BASIS')
  })

  it('verknüpftes Deposit ohne Withdrawal im Stream fällt auf Normalverhalten zurück', () => {
    const report = computeReportDE(
      [
        tx({ type: 'DEPOSIT', qty: 1, ts: '2023-01-01T00:00:00Z', source: 'B', transferGroup: 'g-verwaist' }),
        tx({ type: 'SELL', qty: 1, price: 500, ts: '2024-06-01T00:00:00Z', source: 'B' }),
      ],
      2024,
    )
    // deposit without a price → basis 0 + warning, as if unlinked
    expect(report.disposals[0]?.costBasisEur.toString()).toBe('0')
    expect(warningCodes(report)).toContain('UNKNOWN_ACQUISITION_BASIS')
  })

  it('Oversell-Anteil zieht beim Transfer mit und bleibt steuerpflichtig', () => {
    const report = computeReportDE(
      [
        tx({ type: 'BUY', qty: '0.4', price: 1000, ts: '2020-01-01T00:00:00Z', source: 'A' }),
        // withdrawal for more than tracked: 0.6 uncovered
        tx({ type: 'WITHDRAWAL', qty: 1, ts: '2023-01-01T00:00:00Z', source: 'A', transferGroup: 'g1' }),
        tx({ type: 'DEPOSIT', qty: 1, ts: '2023-01-01T01:00:00Z', source: 'B', transferGroup: 'g1' }),
        tx({ type: 'SELL', qty: 1, price: 1000, ts: '2024-06-01T00:00:00Z', source: 'B' }),
      ],
      2024,
    )
    expect(report.disposals).toHaveLength(2)
    const covered = report.disposals.find((d) => d.acquiredAt !== null)
    const uncovered = report.disposals.find((d) => d.acquiredAt === null)
    // covered portion: 2020 basis, > 1 year → tax-free
    expect(covered?.costBasisEur.toString()).toBe('400')
    expect(covered?.taxable).toBe(false)
    // uncovered portion: basis 0, taxable
    expect(uncovered?.costBasisEur.toString()).toBe('0')
    expect(uncovered?.taxable).toBe(true)
    expect(warningCodes(report)).toContain('SOLD_MORE_THAN_ACQUIRED')
  })

  it('Staking-Zufluss: Einkommen zum Marktwert, Freigrenze 256 €', () => {
    const under = computeReportDE(
      [tx({ type: 'STAKING_REWARD', qty: 1, price: 255, ts: '2024-03-01T00:00:00Z' })],
      2024,
    )
    expect(under.totals.stakingIncomeEur?.toString()).toBe('255')
    expect(under.totals.stakingThresholdEur?.toString()).toBe('256')
    expect(under.totals.stakingTaxableEur?.toString()).toBe('0')

    const at = computeReportDE(
      [tx({ type: 'STAKING_REWARD', qty: 2, price: 128, ts: '2024-03-01T00:00:00Z' })],
      2024,
    )
    expect(at.totals.stakingIncomeEur?.toString()).toBe('256')
    expect(at.totals.stakingTaxableEur?.toString()).toBe('256')
  })

  it('Staking-Lot: Veräußerung nutzt Zuflusswert als Basis, Haltefrist ab Zufluss', () => {
    const report = computeReportDE(
      [
        tx({ type: 'STAKING_REWARD', qty: 1, price: 100, ts: '2023-01-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 500, ts: '2024-06-01T00:00:00Z' }),
      ],
      2024,
    )
    expect(report.disposals[0]?.costBasisEur.toString()).toBe('100')
    expect(report.disposals[0]?.gainEur.toString()).toBe('400')
    // held > 1 year → tax-free; the inflow income does not count toward report year 2024
    expect(report.disposals[0]?.taxable).toBe(false)
    expect(report.totals.stakingIncomeEur?.toString()).toBe('0')
  })

  it('Staking ohne Kurs: kein Einkommen, Basis 0 + Warnung', () => {
    const report = computeReportDE(
      [
        tx({ type: 'STAKING_REWARD', qty: 1, price: null, ts: '2024-01-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 300, ts: '2024-06-01T00:00:00Z' }),
      ],
      2024,
    )
    expect(report.totals.stakingIncomeEur?.toString()).toBe('0')
    expect(report.disposals[0]?.costBasisEur.toString()).toBe('0')
    expect(warningCodes(report)).toContain('UNKNOWN_ACQUISITION_BASIS')
  })

  it('Jahresgrenze: Verkauf 31.12. 23:30 UTC zählt lokal (CET) ins Folgejahr', () => {
    const txs = [
      tx({ type: 'BUY', qty: 1, price: 100, ts: '2023-06-01T00:00:00Z' }),
      // 23:30 UTC am 31.12. = 00:30 lokal (CET, UTC+1) am 01.01. → Veranlagung 2024
      tx({ type: 'SELL', qty: 1, price: 150, ts: '2023-12-31T23:30:00Z' }),
    ]
    expect(computeReportDE(txs, 2023).disposals.length).toBe(0)
    const next = computeReportDE(txs, 2024)
    expect(next.disposals.length).toBe(1)
    expect(next.totals.totalGainEur.toString()).toBe('50')
  })
})

describe('Tax Engine — Österreich (§27b EStG / Alt-/Neuvermögen)', () => {
  it('gleitender Durchschnittspreis wird bei jedem Erwerb neu gebildet', () => {
    const report = computeReportAT(
      [
        tx({ type: 'BUY', qty: 1, price: 100, ts: '2022-01-01T00:00:00Z' }),
        tx({ type: 'BUY', qty: 1, price: 200, ts: '2022-02-01T00:00:00Z' }),
        // average 150 → gain 100
        tx({ type: 'SELL', qty: 1, price: 250, ts: '2022-03-01T00:00:00Z' }),
        // pool: 1 unit at 150; +1 at 300 → average 225 → gain 0
        tx({ type: 'BUY', qty: 1, price: 300, ts: '2022-04-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 225, ts: '2022-05-01T00:00:00Z' }),
      ],
      2022,
    )
    expect(report.disposals).toHaveLength(2)
    expect(report.disposals[0]?.costBasisEur.toString()).toBe('150')
    expect(report.disposals[0]?.gainEur.toString()).toBe('100')
    expect(report.disposals[1]?.costBasisEur.toString()).toBe('225')
    expect(report.disposals[1]?.gainEur.toString()).toBe('0')
    expect(report.totals.atNeuvermoegenGainEur?.toString()).toBe('100')
  })

  it('Stichtag 1.3.2021: Anschaffung davor = Alt, ab Stichtag = Neu', () => {
    const report = computeReportAT(
      [
        tx({ type: 'BUY', qty: 1, price: 100, ts: '2021-02-28T23:59:59Z' }),
        tx({ type: 'BUY', qty: 1, price: 100, ts: '2021-03-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 2, price: 300, ts: '2023-06-01T00:00:00Z' }),
      ],
      2023,
    )
    const regimes = report.disposals.map((d) => d.regime).sort()
    expect(regimes).toEqual(['AT_ALTVERMOEGEN', 'AT_NEUVERMOEGEN'])
  })

  it('Altvermögen > 1 Jahr gehalten ist steuerfrei', () => {
    const report = computeReportAT(
      [
        tx({ type: 'BUY', qty: 1, price: 1000, ts: '2019-01-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 5000, ts: '2025-01-01T00:00:00Z' }),
      ],
      2025,
    )
    expect(report.disposals[0]?.regime).toBe('AT_ALTVERMOEGEN')
    expect(report.disposals[0]?.taxable).toBe(false)
    expect(report.totals.taxFreeGainEur.toString()).toBe('4000')
    expect(report.totals.taxableAfterThresholdEur.toString()).toBe('0')
  })

  it('Altvermögen ≤ 1 Jahr: Spekulationsgeschäft mit Freigrenze 440 €', () => {
    const report = computeReportAT(
      [
        tx({ type: 'BUY', qty: 1, price: 100, ts: '2021-01-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 500, ts: '2021-06-01T00:00:00Z' }),
      ],
      2021,
    )
    expect(report.disposals[0]?.taxable).toBe(true)
    expect(report.totals.taxableGainEur.toString()).toBe('400')
    // 400 < 440 → Freigrenze not reached
    expect(report.totals.thresholdApplied).toBe(false)
    expect(report.totals.taxableAfterThresholdEur.toString()).toBe('0')
  })

  it('Neuvermögen ist unabhängig von der Haltedauer steuerpflichtig', () => {
    const report = computeReportAT(
      [
        tx({ type: 'BUY', qty: 1, price: 100, ts: '2021-06-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 500, ts: '2025-06-01T00:00:00Z' }),
      ],
      2025,
    )
    expect(report.disposals[0]?.regime).toBe('AT_NEUVERMOEGEN')
    expect(report.disposals[0]?.taxable).toBe(true)
    // no Freigrenze on Neuvermögen
    expect(report.totals.taxableAfterThresholdEur.toString()).toBe('400')
    expect(report.totals.atNeuvermoegenGainEur?.toString()).toBe('400')
  })

  it('gemischter Verkauf: Altvermögen wird zuerst verbraucht', () => {
    const report = computeReportAT(
      [
        tx({ type: 'BUY', qty: 1, price: 100, ts: '2020-01-01T00:00:00Z' }),
        tx({ type: 'BUY', qty: 1, price: 200, ts: '2022-01-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: '1.5', price: 300, ts: '2023-06-01T00:00:00Z' }),
      ],
      2023,
    )
    expect(report.disposals).toHaveLength(2)
    const alt = report.disposals.find((d) => d.regime === 'AT_ALTVERMOEGEN')
    const neu = report.disposals.find((d) => d.regime === 'AT_NEUVERMOEGEN')
    // Altvermögen: 1 unit, basis 100, proceeds 300, > 1 year → tax-free
    expect(alt?.quantity.toString()).toBe('1')
    expect(alt?.gainEur.toString()).toBe('200')
    expect(alt?.taxable).toBe(false)
    // Neuvermögen: 0.5 unit, basis 100 (average 200), proceeds 150 → gain 50
    expect(neu?.quantity.toString()).toBe('0.5')
    expect(neu?.costBasisEur.toString()).toBe('100')
    expect(neu?.gainEur.toString()).toBe('50')
    expect(neu?.taxable).toBe(true)

    expect(report.totals.taxFreeGainEur.toString()).toBe('200')
    expect(report.totals.taxableGainEur.toString()).toBe('50')
    expect(report.totals.taxableAfterThresholdEur.toString()).toBe('50')
  })

  it('Oversell: ungedeckter Anteil als Neuvermögen mit Basis 0 + Warnung', () => {
    const report = computeReportAT(
      [tx({ type: 'SELL', qty: 1, price: 100, ts: '2024-01-01T00:00:00Z' })],
      2024,
    )
    expect(report.disposals).toHaveLength(1)
    expect(report.disposals[0]?.regime).toBe('AT_NEUVERMOEGEN')
    expect(report.disposals[0]?.costBasisEur.toString()).toBe('0')
    expect(report.disposals[0]?.taxable).toBe(true)
    expect(warningCodes(report)).toContain('SOLD_MORE_THAN_ACQUIRED')
  })

  it('WITHDRAWAL verbraucht Alt- und Neubestand ohne steuerbaren Vorgang', () => {
    const report = computeReportAT(
      [
        tx({ type: 'BUY', qty: 1, price: 100, ts: '2020-01-01T00:00:00Z' }),
        tx({ type: 'WITHDRAWAL', qty: 1, ts: '2022-01-01T00:00:00Z' }),
        tx({ type: 'BUY', qty: 1, price: 200, ts: '2023-01-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 300, ts: '2024-01-01T00:00:00Z' }),
      ],
      2024,
    )
    // the old holding was withdrawn — what is sold is Neuvermögen (basis 200)
    expect(report.disposals).toHaveLength(1)
    expect(report.disposals[0]?.regime).toBe('AT_NEUVERMOEGEN')
    expect(report.disposals[0]?.costBasisEur.toString()).toBe('200')
    expect(warningCodes(report)).toContain('WITHDRAWAL_REMOVED_LOTS')
  })

  it('AT: verknüpfter Transfer ist neutral (globale Pools unverändert)', () => {
    const base = [
      tx({ type: 'BUY', qty: 2, price: 100, ts: '2022-01-01T00:00:00Z', source: 'A' }),
      tx({ type: 'SELL', qty: 1, price: 400, ts: '2024-06-01T00:00:00Z', source: 'B' }),
    ]
    const withTransfer = [
      base[0] as EngineTx,
      tx({ type: 'WITHDRAWAL', qty: 1, ts: '2023-01-01T00:00:00Z', source: 'A', transferGroup: 'g1' }),
      tx({ type: 'DEPOSIT', qty: 1, ts: '2023-01-01T01:00:00Z', source: 'B', transferGroup: 'g1' }),
      base[1] as EngineTx,
    ]
    const without = computeReportAT(base, 2024)
    const withTx = computeReportAT(withTransfer, 2024)
    // identical results, no warnings caused by the transfer
    expect(withTx.totals.taxableAfterThresholdEur.toString()).toBe(
      without.totals.taxableAfterThresholdEur.toString(),
    )
    expect(withTx.disposals[0]?.costBasisEur.toString()).toBe(without.disposals[0]?.costBasisEur.toString())
    expect(warningCodes(withTx)).not.toContain('WITHDRAWAL_REMOVED_LOTS')
    expect(warningCodes(withTx)).not.toContain('UNKNOWN_ACQUISITION_BASIS')
  })

  it('Staking AT: kein Zufluss-Einkommen, Anschaffungskosten 0, Verkauf voll steuerpflichtig', () => {
    const report = computeReportAT(
      [
        tx({ type: 'STAKING_REWARD', qty: 1, price: 100, ts: '2022-01-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: 500, ts: '2024-06-01T00:00:00Z' }),
      ],
      2024,
    )
    // §27b Abs. 2: basis 0 → the full proceeds are gain (Neuvermögen, 27.5 %)
    expect(report.disposals[0]?.regime).toBe('AT_NEUVERMOEGEN')
    expect(report.disposals[0]?.costBasisEur.toString()).toBe('0')
    expect(report.disposals[0]?.gainEur.toString()).toBe('500')
    expect(report.totals.stakingIncomeEur).toBeUndefined()
    expect(report.warnings).toHaveLength(0)
  })

  it('SELL ohne Kurs bleibt aus den AT-Summen draußen', () => {
    const report = computeReportAT(
      [
        tx({ type: 'BUY', qty: 1, price: 100, ts: '2022-01-01T00:00:00Z' }),
        tx({ type: 'SELL', qty: 1, price: null, ts: '2024-03-01T00:00:00Z' }),
      ],
      2024,
    )
    expect(report.disposals[0]?.priceQuality).toBe('MISSING')
    expect(report.totals.totalGainEur.toString()).toBe('0')
    expect(warningCodes(report)).toContain('MISSING_DISPOSAL_PRICE')
  })

  it('Altvermögen-Verlust mindert NICHT den Neuvermögen-Gewinn (getrennte Töpfe)', () => {
    const report = computeReportAT(
      [
        // Altvermögen (vor Stichtag), ≤ 1 Jahr gehalten → steuerpflichtiges
        // Spekulationsgeschäft mit Verlust -40
        tx({ type: 'BUY', qty: 1, price: 100, ts: '2021-02-01T00:00:00Z', symbol: 'BTC' }),
        tx({ type: 'SELL', qty: 1, price: 60, ts: '2021-06-01T00:00:00Z', symbol: 'BTC' }),
        // Neuvermögen (ab Stichtag), Gewinn +100, immer steuerpflichtig (27,5 %)
        tx({ type: 'BUY', qty: 1, price: 100, ts: '2021-04-01T00:00:00Z', symbol: 'ETH' }),
        tx({ type: 'SELL', qty: 1, price: 200, ts: '2021-08-01T00:00:00Z', symbol: 'ETH' }),
      ],
      2021,
    )
    // Gesamt nettet informativ: -40 + 100 = 60
    expect(report.totals.totalGainEur.toString()).toBe('60')
    // Neuvermögen-Topf bleibt voll steuerpflichtig — Alt-Verlust darf nicht abziehen
    expect(report.totals.atNeuvermoegenGainEur?.toString()).toBe('100')
    expect(report.totals.taxableGainEur.toString()).toBe('100')
    expect(report.totals.taxableAfterThresholdEur.toString()).toBe('100')
    // 27,5 % Sondersteuersatz auf den Neuvermögen-Gewinn
    expect(report.totals.atNeuvermoegenTaxEur?.toString()).toBe('27.5')
  })
})

describe('Tax Engine — Kostenbasis aktueller Bestände (PnL)', () => {
  it('FIFO-Restbestand: BUY 2@100 + SELL 1 → Menge 1, Kostenbasis 100', () => {
    const m = computeHoldingsCostBasis([
      tx({ type: 'BUY', qty: 2, price: 100, ts: '2024-01-01' }),
      tx({ type: 'SELL', qty: 1, price: 150, ts: '2024-02-01' }),
    ])
    const pos = m.get('src-1|BTC')
    expect(pos?.quantity.toString()).toBe('1')
    expect(pos?.costBasisEur.toString()).toBe('100')
  })

  it('Staking-Reward erhöht Menge + Kostenbasis (Zuflusswert)', () => {
    const m = computeHoldingsCostBasis([
      tx({ type: 'BUY', qty: 1, price: 100, ts: '2024-01-01' }),
      tx({ type: 'STAKING_REWARD', qty: 0.5, price: 200, ts: '2024-03-01' }),
    ])
    const pos = m.get('src-1|BTC')
    expect(pos?.quantity.toString()).toBe('1.5')
    expect(pos?.costBasisEur.toString()).toBe('200')
  })

  it('verknüpfter Transfer zieht die Kostenbasis in die Zielquelle um', () => {
    const m = computeHoldingsCostBasis([
      tx({ type: 'BUY', qty: 1, price: 100, ts: '2024-01-01', source: 'src-A' }),
      tx({ type: 'WITHDRAWAL', qty: 1, ts: '2024-02-01', source: 'src-A', transferGroup: 'g1' }),
      tx({ type: 'DEPOSIT', qty: 1, ts: '2024-02-01', source: 'src-B', transferGroup: 'g1' }),
    ])
    expect(m.get('src-A|BTC')).toBeUndefined()
    const b = m.get('src-B|BTC')
    expect(b?.quantity.toString()).toBe('1')
    expect(b?.costBasisEur.toString()).toBe('100')
  })

  it('ohne Transaktionen → leere Map', () => {
    expect(computeHoldingsCostBasis([]).size).toBe(0)
  })
})

describe('Tax Engine — Krypto-zu-Krypto-Swap', () => {
  const swapTxs = () => [
    tx({ type: 'BUY', qty: 1, price: 20000, ts: '2024-01-01T00:00:00Z', symbol: 'BTC' }),
    tx({ type: 'SELL', qty: 1, price: 25000, ts: '2024-06-01T00:00:00Z', symbol: 'BTC', swapGroup: 's1' }),
    tx({ type: 'BUY', qty: 10, price: 2500, ts: '2024-06-01T00:00:00Z', symbol: 'ETH', swapGroup: 's1' }),
    tx({ type: 'SELL', qty: 10, price: 3000, ts: '2024-09-01T00:00:00Z', symbol: 'ETH' }),
  ]

  it('AT: Tausch steueraufgeschoben — keine BTC-Veräußerung, Kostenbasis wandert auf ETH', () => {
    const at = computeReportAT(swapTxs(), 2024)
    // only the later ETH sale is a disposal; the swap itself is not
    expect(at.disposals).toHaveLength(1)
    const eth = at.disposals[0]
    expect(eth?.assetSymbol).toBe('ETH')
    expect(eth?.regime).toBe('AT_NEUVERMOEGEN')
    // ETH cost basis = carried-over BTC cost basis 20,000 (not 25,000)
    expect(eth?.costBasisEur.toString()).toBe('20000')
    expect(eth?.gainEur.toString()).toBe('10000')
    expect(warningCodes(at)).toContain('SWAP_DEFERRED')
  })

  it('DE: Tausch ist steuerpflichtig — BTC-Veräußerung + ETH-Erwerb wie SELL/BUY', () => {
    const de = computeReportDE(swapTxs(), 2024)
    expect(de.disposals).toHaveLength(2)
    const btc = de.disposals.find((d) => d.assetSymbol === 'BTC')
    const eth = de.disposals.find((d) => d.assetSymbol === 'ETH')
    expect(btc?.gainEur.toString()).toBe('5000') // 25000 − 20000
    expect(eth?.gainEur.toString()).toBe('5000') // 30000 − 25000
  })
})
