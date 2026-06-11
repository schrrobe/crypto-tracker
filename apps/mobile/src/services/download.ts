// CSV-Erzeugung + Browser-Download. Semikolon-getrennt mit UTF-8-BOM,
// damit deutsches/österreichisches Excel Umlaute und Spalten korrekt erkennt.

const UTF8_BOM = '\ufeff'

function escapeCell(value: string | number): string {
  const s = String(value)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildCsv(header: string[], rows: Array<Array<string | number>>): string {
  return [header, ...rows].map((row) => row.map(escapeCell).join(';')).join('\r\n')
}

export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number>>): void {
  const blob = new Blob([UTF8_BOM + buildCsv(header, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
