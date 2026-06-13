import { ref } from 'vue'
import { getStored, setStored } from './storage'

// Privatsphäre-Modus: blendet alle Geldbeträge/Bestände in der UI aus, damit man
// das Dashboard zeigen kann, ohne die eigenen Finanzen preiszugeben. Reaktiv —
// Templates, die formatCurrency/formatQuantity aufrufen, rendern beim Umschalten neu.
const STORAGE_KEY = 'balances-hidden'

export const balancesHidden = ref(false)

// Maskierungs-Platzhalter für ausgeblendete Beträge.
export const BALANCE_MASK = '••••'

// Nach preloadStorage() im Bootstrap aufrufen (Cache ist dann gefüllt).
export function initPrivacy(): void {
  balancesHidden.value = getStored(STORAGE_KEY) === '1'
}

export function toggleBalances(): void {
  balancesHidden.value = !balancesHidden.value
  setStored(STORAGE_KEY, balancesHidden.value ? '1' : '0')
}
