import { ref } from 'vue'
import { getStored, setStored } from './storage'

// Privacy mode: hides all monetary amounts/balances in the UI so the dashboard
// can be shown without revealing one's own finances. Reactive —
// templates that call formatCurrency/formatQuantity re-render when toggled.
const STORAGE_KEY = 'balances-hidden'

export const balancesHidden = ref(false)

// Masking placeholder for hidden amounts.
export const BALANCE_MASK = '••••'

// Call after preloadStorage() in bootstrap (the cache is filled by then).
export function initPrivacy(): void {
  balancesHidden.value = getStored(STORAGE_KEY) === '1'
}

export function toggleBalances(): void {
  balancesHidden.value = !balancesHidden.value
  setStored(STORAGE_KEY, balancesHidden.value ? '1' : '0')
}
