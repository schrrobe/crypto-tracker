import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TaxCountry, TaxReportDto } from '@crypto-tracker/shared'
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

  return { report, year, country, load, clearCache, setCountry, reset }
})
