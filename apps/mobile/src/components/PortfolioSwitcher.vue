<template>
  <!-- Nur sichtbar, wenn es mehr als ein Portfolio gibt -->
  <ion-button
    v-if="store.hasMultiple"
    fill="clear"
    size="small"
    data-testid="portfolio-switcher"
    @click="open = true"
  >
    {{ store.active?.label ?? '…' }}
    <ion-icon :icon="chevronDownOutline" slot="end" />
  </ion-button>

  <ion-action-sheet
    :is-open="open"
    :header="$t('portfolios.switchTitle')"
    :buttons="buttons"
    @didDismiss="open = false"
  />
</template>

<script setup lang="ts">
import { IonActionSheet, IonButton, IonIcon } from '@ionic/vue'
import { chevronDownOutline } from 'ionicons/icons'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { usePortfoliosStore } from '../stores/portfolios.store'
import { usePortfolioStore } from '../stores/portfolio.store'
import { useSourcesStore } from '../stores/sources.store'
import { useTransactionsStore } from '../stores/transactions.store'
import { useTaxStore } from '../stores/tax.store'
import { useImportsStore } from '../stores/imports.store'
import { t } from '../i18n'

const emit = defineEmits<{ switched: [] }>()

const store = usePortfoliosStore()
const router = useRouter()
const open = ref(false)

async function switchTo(id: string) {
  const isDefault = store.portfolios.find((p) => p.id === id)?.isDefault
  store.setActive(isDefault ? null : id)
  // gescopte Stores leeren — die sichtbare Seite lädt über ihr ionViewWillEnter
  // bzw. das switched-Event neu
  usePortfolioStore().reset()
  useSourcesStore().reset()
  useTransactionsStore().reset()
  useTaxStore().reset()
  useImportsStore().imports = []
  emit('switched')
}

const buttons = computed(() => [
  ...store.portfolios.map((p) => ({
    text: p.id === store.active?.id ? `✓ ${p.label}` : p.label,
    handler: () => {
      switchTo(p.id)
    },
  })),
  {
    text: t('portfolios.manage'),
    handler: () => {
      router.push('/tabs/settings')
    },
  },
  { text: t('common.cancel'), role: 'cancel' },
])
</script>
