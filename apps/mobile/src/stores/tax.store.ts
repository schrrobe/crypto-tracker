import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TaxCountry, TaxReportDto } from '@crypto-tracker/shared'
import { TaxWarningCode } from '@crypto-tracker/shared'
import { api } from '../services/api.client'
import { getStored, setStored } from '../services/storage'
import { usePortfoliosStore } from './portfolios.store'

const COUNTRY_KEY = 'taxCountry'

function storedCountry(): TaxCountry {
  return getStored(COUNTRY_KEY) === 'AT' ? 'AT' : 'DE'
}

export const useTaxStore = defineStore('tax', () => {
  const report = ref<TaxReportDto | null>(null)
  // Default: letztes abgeschlossenes Steuerjahr
  const year = ref(new Date().getFullYear() - 1)
  const country = ref<TaxCountry>(storedCountry())

  // Session cache so toggling year/country back and forth in the open report
  // does not re-hit the API (and re-run CoinGecko backfill). Cleared on view
  // (re-)entry via clearCache() so freshly imported transactions are not stale.
  const cache = new Map<string, TaxReportDto>()

  // True while loadWithBackfill is topping up daily prices in extra passes.
  const backfilling = ref(false)
  // Upper bound on automatic re-fetches (cap is 40/run without a key →
  // 20 passes ≈ 800 daily prices) so a never-clearing warning cannot loop forever.
  const MAX_BACKFILL_PASSES = 20

  async function load(force = false): Promise<void> {
    const scope = usePortfoliosStore().scopeQuery('&')
    const key = `${country.value}|${year.value}|${scope}`
    const cached = cache.get(key)
    if (!force && cached) {
      report.value = cached
      return
    }
    const fresh = await api.get<TaxReportDto>(
      `/tax/report?year=${year.value}&country=${country.value}${scope}`,
    )
    cache.set(key, fresh)
    report.value = fresh
  }

  // Loads the report, then keeps reloading (force) while the per-run price-lookup
  // cap left daily prices unresolved (PRICE_LOOKUP_LIMIT_REACHED). Each pass fills
  // the next batch from CoinGecko into the DB cache, so the user no longer has to
  // re-open the report manually. Bounded by MAX_BACKFILL_PASSES; a transient error
  // stops the loop but keeps whatever was loaded.
  async function loadWithBackfill(): Promise<void> {
    await load()
    let passes = 0
    while (
      passes < MAX_BACKFILL_PASSES &&
      report.value?.warnings.some((w) => w.code === TaxWarningCode.PRICE_LOOKUP_LIMIT_REACHED)
    ) {
      passes += 1
      backfilling.value = true
      try {
        await load(true)
      } catch {
        break
      }
    }
    backfilling.value = false
  }

  function clearCache(): void {
    cache.clear()
  }

  function setCountry(value: TaxCountry): void {
    country.value = value
    setStored(COUNTRY_KEY, value)
  }

  function reset(): void {
    report.value = null
    cache.clear()
  }

  return { report, year, country, backfilling, load, loadWithBackfill, clearCache, setCountry, reset }
})
