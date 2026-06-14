import { ProviderError, type RawBalance } from '../provider.types'

// Führt eine Konto-Typ-Sub-Abfrage (Earn/Margin) resilient aus: bei
// ENDPOINT_FORBIDDEN (Key ohne Berechtigung für diesen Subendpoint) wird der
// Kontotyp übersprungen und eine Warnung gesammelt — der Spot-Sync läuft weiter.
// Andere ProviderError (echte Ausfälle) propagieren.
export async function safeSubFetch(
  fn: () => Promise<RawBalance[]>,
  label: string,
  warnings: string[],
): Promise<RawBalance[]> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ProviderError && err.code === 'ENDPOINT_FORBIDDEN') {
      warnings.push(`${label}: ${err.message}`)
      return []
    }
    throw err
  }
}
