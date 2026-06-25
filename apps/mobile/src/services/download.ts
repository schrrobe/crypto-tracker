// CSV generation + export. Semicolon-separated with UTF-8 BOM so that
// German/Austrian Excel recognizes umlauts and columns correctly.

import { saveOrShareFile } from './file-export'

const UTF8_BOM = '\ufeff'

// CSV / formula injection: a cell beginning with = + - @ (or a tab/CR) is
// evaluated as a formula by Excel / LibreOffice / Sheets, so a user-controlled
// value (e.g. a source label "=HYPERLINK(...)" or asset name from CoinGecko) can
// run when the export is opened. Prefix such cells with an apostrophe so they are
// read as text. Pure numbers \u2014 including signed and German decimal-comma values
// like "-1234,56" \u2014 are safe and left intact so money/quantity columns stay numeric.
function neutralizeFormula(s: string): string {
  if (s === '' || /^[-+]?[\d.,]+$/.test(s)) return s
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}

function escapeCell(value: string | number): string {
  const s = neutralizeFormula(String(value))
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildCsv(header: string[], rows: Array<Array<string | number>>): string {
  return [header, ...rows].map((row) => row.map(escapeCell).join(';')).join('\r\n')
}

export async function downloadCsv(
  filename: string,
  header: string[],
  rows: Array<Array<string | number>>,
): Promise<void> {
  const blob = new Blob([UTF8_BOM + buildCsv(header, rows)], { type: 'text/csv;charset=utf-8' })
  await saveOrShareFile(filename, blob)
}
