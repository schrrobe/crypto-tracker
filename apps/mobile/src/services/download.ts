// CSV generation + export. Semicolon-separated with UTF-8 BOM so that
// German/Austrian Excel recognizes umlauts and columns correctly.

import { saveOrShareFile } from './file-export'

const UTF8_BOM = '\ufeff'

function escapeCell(value: string | number): string {
  const s = String(value)
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
