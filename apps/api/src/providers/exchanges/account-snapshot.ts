import { ProviderError, type RawBalance } from '../provider.types'

// Runs an account-type sub-query (Earn/Margin) resiliently: on
// ENDPOINT_FORBIDDEN (key without permission for this sub-endpoint), the
// account type is skipped and a warning is collected — the spot sync continues.
// Other ProviderError (real failures) propagate.
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
