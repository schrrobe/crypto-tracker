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

  async function load(): Promise<void> {
    const scope = usePortfoliosStore().scopeQuery('&')
    report.value = await api.get<TaxReportDto>(
      `/tax/report?year=${year.value}&country=${country.value}${scope}`,
    )
  }

  function setCountry(value: TaxCountry): void {
    country.value = value
    setStored(COUNTRY_KEY, value)
  }

  function reset(): void {
    report.value = null
  }

  return { report, year, country, load, setCountry, reset }
})
