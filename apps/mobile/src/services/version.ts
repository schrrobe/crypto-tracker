// Numeric semver-ish comparison for "x.y.z" version strings.
// Missing segments count as 0 ("1.2" == "1.2.0"). Returns -1 | 0 | 1.
// Throws on unparseable input so callers can fail-open (don't block on garbage).
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}

function parse(v: string): number[] {
  const trimmed = v.trim()
  if (!trimmed) throw new Error(`Invalid version: "${v}"`)
  return trimmed.split('.').map((seg) => {
    const n = Number(seg)
    if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid version segment in "${v}"`)
    return n
  })
}
