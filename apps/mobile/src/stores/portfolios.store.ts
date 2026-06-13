import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { PortfolioDto } from '@crypto-tracker/shared'
import { api } from '../services/api.client'
import { getStored, removeStored, setStored } from '../services/storage'

const STORAGE_KEY = 'active-portfolio-id'

// Aktives Portfolio steuert den Scope aller Daten-Stores (Quellen, Bestände,
// Transaktionen, Steuerreport, Importe). null = Default-Portfolio des Backends.
export const usePortfoliosStore = defineStore('portfolios', () => {
  const portfolios = ref<PortfolioDto[]>([])
  const activePortfolioId = ref<string | null>(getStored(STORAGE_KEY))
  const loaded = ref(false)

  const active = computed(
    () =>
      portfolios.value.find((p) => p.id === activePortfolioId.value) ??
      portfolios.value.find((p) => p.isDefault) ??
      null,
  )
  // Switcher nur zeigen, wenn es etwas zu wechseln gibt
  const hasMultiple = computed(() => portfolios.value.length > 1)

  async function load(): Promise<void> {
    portfolios.value = (await api.get<{ portfolios: PortfolioDto[] }>('/portfolios')).portfolios
    loaded.value = true
    // gespeicherte ID verschwunden (gelöscht/anderer User) → zurück auf Default
    if (activePortfolioId.value && !portfolios.value.some((p) => p.id === activePortfolioId.value)) {
      setActive(null)
    }
  }

  async function ensureLoaded(): Promise<void> {
    if (!loaded.value) await load()
  }

  function setActive(id: string | null): void {
    activePortfolioId.value = id
    if (id) setStored(STORAGE_KEY, id)
    else removeStored(STORAGE_KEY)
  }

  // Query-Anhang für gescopte GET-Aufrufe ('' wenn Default aktiv)
  function scopeQuery(prefix: '?' | '&' = '?'): string {
    return activePortfolioId.value
      ? `${prefix}portfolioId=${encodeURIComponent(activePortfolioId.value)}`
      : ''
  }

  // Body-/Formular-Feld für Creates (undefined wenn Default aktiv)
  function scopeId(): string | undefined {
    return activePortfolioId.value ?? undefined
  }

  async function create(label: string): Promise<PortfolioDto> {
    const { portfolio } = await api.post<{ portfolio: PortfolioDto }>('/portfolios', { label })
    await load()
    return portfolio
  }

  async function rename(id: string, label: string): Promise<void> {
    await api.patch(`/portfolios/${id}`, { label })
    await load()
  }

  async function remove(id: string): Promise<void> {
    await api.delete(`/portfolios/${id}`)
    if (activePortfolioId.value === id) setActive(null)
    await load()
  }

  function reset(): void {
    portfolios.value = []
    loaded.value = false
    setActive(null)
  }

  return {
    portfolios,
    activePortfolioId,
    active,
    hasMultiple,
    load,
    ensureLoaded,
    setActive,
    scopeQuery,
    scopeId,
    create,
    rename,
    remove,
    reset,
  }
})
