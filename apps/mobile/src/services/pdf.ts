// PDF export of the tax report. Content is deliberately always German — the
// recipient is the tax office/tax advisor in DE/AT; it also avoids font embedding
// for special characters from PL/CS/RU (jsPDF default fonts cover Latin-1).
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { TaxReportDto } from '@crypto-tracker/shared'
import { saveOrShareFile } from './file-export'

const REGIME_LABELS: Record<string, string> = {
  DE_PRIVATE_SALE: '§23 EStG',
  AT_ALTVERMOEGEN: 'Altvermögen',
  AT_NEUVERMOEGEN: 'Neuvermögen (27,5 %)',
}

const WARNING_TEXTS: Record<string, string> = {
  UNKNOWN_ACQUISITION_BASIS: 'Erwerb ohne Kurs — Anschaffungskosten 0 angesetzt',
  MISSING_DISPOSAL_PRICE: 'Veräußerung ohne ermittelbaren Kurs — nicht in den Summen',
  SOLD_MORE_THAN_ACQUIRED: 'Mehr veräußert als angeschafft erfasst — ungedeckter Anteil mit Basis 0',
  WITHDRAWAL_REMOVED_LOTS: 'Auszahlungen haben Bestände aus der Verfolgung entfernt',
  TRANSFERS_IGNORED: 'Transfer-/Sonstige-Transaktionen wurden ignoriert',
  FOREIGN_CURRENCY_PRICE_IGNORED: 'Kurs in Fremdwährung verworfen — EUR-Tagespreis verwendet',
  PRICE_LOOKUP_LIMIT_REACHED: 'Kurs-Abfragelimit erreicht — Report erneut erstellen',
}

const DISCLAIMER =
  'Keine Steuerberatung. Unverbindliche Berechnungshilfe. Annahmen: FIFO je Quelle/Wallet (DE, ' +
  'BMF-Schreiben v. 10.05.2022), verknüpfte Transfers übertragen die Kostenbasis; Altvermögen ' +
  'wird zuerst verbraucht (AT); Crypto-zu-Crypto-Tausch und Fremdwährungsumrechnung sind nicht ' +
  'abgebildet. Alle Angaben ohne Gewähr.'

function eur(value: string): string {
  return `${Number(value).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

function date(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE')
}

export function buildTaxReportPdf(report: TaxReportDto): jsPDF {
  const doc = new jsPDF()
  const country = report.country === 'DE' ? 'Deutschland' : 'Österreich'

  doc.setFontSize(16)
  doc.text(`Steuerreport ${report.year} — ${country}`, 14, 18)
  doc.setFontSize(9)
  doc.setTextColor(120)
  doc.text(
    `Steuersubjekt: ${report.portfolioLabel} · Erstellt am ${date(report.generatedAt)} · Crypto Tracker · Währung EUR`,
    14,
    24,
  )
  doc.setTextColor(0)

  // Totals block
  const totals: Array<[string, string]> = [
    ['Gesamtergebnis', eur(report.totals.totalGainEur)],
    ['Steuerfrei (Haltefrist)', eur(report.totals.taxFreeGainEur)],
    ['Steuerpflichtig (vor Freigrenze)', eur(report.totals.taxableGainEur)],
  ]
  if (report.totals.thresholdEur) {
    totals.push([
      `Freigrenze (${eur(report.totals.thresholdEur)})`,
      report.totals.thresholdApplied ? 'erreicht — voll steuerpflichtig' : 'nicht erreicht',
    ])
  }
  totals.push(['Steuerpflichtiges Ergebnis', eur(report.totals.taxableAfterThresholdEur)])
  if (report.totals.atNeuvermoegenGainEur !== undefined) {
    totals.push(['davon Neuvermögen (27,5 %)', eur(report.totals.atNeuvermoegenGainEur)])
  }
  if (report.totals.stakingIncomeEur !== undefined) {
    totals.push(['Staking-Einkünfte bei Zufluss (§22 Nr. 3 EStG)', eur(report.totals.stakingIncomeEur)])
    if (report.totals.stakingTaxableEur !== undefined) {
      totals.push(['Steuerpflichtige Staking-Einkünfte', eur(report.totals.stakingTaxableEur)])
    }
  }
  autoTable(doc, {
    startY: 30,
    head: [],
    body: totals,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 1.5 },
    columnStyles: { 1: { halign: 'right' } },
  })

  // Disposals list
  if (report.disposals.length > 0) {
    autoTable(doc, {
      startY: (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6,
      head: [['Asset', 'Menge', 'Anschaffung', 'Veräußerung', 'AK (EUR)', 'Erlös (EUR)', 'G/V (EUR)', 'Status', 'Regime']],
      body: report.disposals.map((d) => [
        d.assetSymbol,
        d.quantity,
        d.acquiredAt ? date(d.acquiredAt) : 'unbekannt',
        date(d.disposedAt),
        eur(d.costBasisEur),
        eur(d.proceedsEur),
        eur(d.gainEur),
        d.taxable ? 'steuerpflichtig' : 'steuerfrei',
        REGIME_LABELS[d.regime] ?? d.regime,
      ]),
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [60, 60, 60] },
    })
  }

  // Notes
  if (report.warnings.length > 0) {
    let y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
    doc.setFontSize(10)
    doc.text('Hinweise:', 14, y)
    doc.setFontSize(8)
    for (const w of report.warnings) {
      y += 5
      if (y > 280) {
        doc.addPage()
        y = 18
      }
      const prefix = w.assetSymbol ? `${w.assetSymbol}: ` : ''
      const count = w.count && w.count > 1 ? ` (${w.count}×)` : ''
      doc.text(`• ${prefix}${WARNING_TEXTS[w.code] ?? w.code}${count}`, 16, y)
    }
  }

  // Disclaimer as a footnote on every page
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(120)
    doc.text(doc.splitTextToSize(DISCLAIMER, 180), 14, 287)
    doc.setTextColor(0)
  }

  return doc
}

export async function downloadTaxReportPdf(report: TaxReportDto): Promise<void> {
  const blob = buildTaxReportPdf(report).output('blob')
  const slug =
    report.portfolioLabel
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'portfolio'
  await saveOrShareFile(`steuerreport-${slug}-${report.country}-${report.year}.pdf`, blob)
}
