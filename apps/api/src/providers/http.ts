import { ProviderError } from './provider.types'

const DEFAULT_TIMEOUT_MS = 15_000

// fetch with a hard timeout so a hung connection cannot block a sync run
// indefinitely. A timeout surfaces as a retryable PROVIDER_ERROR.
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new ProviderError('PROVIDER_ERROR', `Zeitüberschreitung nach ${timeoutMs / 1000}s`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}
