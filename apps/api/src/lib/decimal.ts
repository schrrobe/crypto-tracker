// Konvertiert ganzzahlige Basis-Einheiten (Satoshi, Lamports, SPL-Raw-Amounts)
// in einen Dezimal-String — bewusst ohne float, BigInt-basiert.
export function fromBaseUnits(units: bigint, decimals: number): string {
  const negative = units < 0n
  const abs = negative ? -units : units
  const sign = negative ? '-' : ''

  if (decimals === 0) return `${sign}${abs.toString()}`

  const raw = abs.toString().padStart(decimals + 1, '0')
  const intPart = raw.slice(0, raw.length - decimals)
  const fracPart = raw.slice(raw.length - decimals).replace(/0+$/, '')
  return fracPart ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`
}
