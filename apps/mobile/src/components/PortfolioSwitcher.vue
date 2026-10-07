<template>
  <!-- Only visible when there is more than one tax entity to switch between -->
  <template v-if="store.hasMultiple">
    <!-- Banner variant: a prominent in-content strip naming the active tax entity.
         Used on scoped sub-pages (transactions, tax, imports) so the user can never
         add or read data without seeing which tax subject it belongs to. -->
    <ion-item
      v-if="variant === 'banner'"
      :button="true"
      lines="full"
      :detail="false"
      color="light"
      data-testid="portfolio-banner"
      @click="openSheet"
    >
      <ion-icon :icon="briefcaseOutline" slot="start" />
      <ion-label>
        <p class="banner-eyebrow">{{ $t('portfolios.activeEntity') }}</p>
        <h2 class="banner-name">{{ store.active?.label ?? '…' }}</h2>
      </ion-label>
      <ion-note slot="end">{{ $t('portfolios.switch') }}</ion-note>
    </ion-item>

    <!-- Header variant: compact control for top-level tab headers. -->
    <ion-button
      v-else
      fill="clear"
      size="small"
      data-testid="portfolio-switcher"
      :aria-label="`${$t('portfolios.switchTitle')}: ${store.active?.label ?? ''}`"
      @click="openSheet"
    >
      {{ store.active?.label ?? '…' }}
      <ion-icon :icon="chevronDownOutline" slot="end" />
    </ion-button>
  </template>
</template>

<script setup lang="ts">
import {
  actionSheetController,
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonNote,
  toastController,
} from '@ionic/vue'
import { briefcaseOutline, checkmark, chevronDownOutline } from 'ionicons/icons'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { usePortfoliosStore } from '../stores/portfolios.store'
import { usePortfolioStore } from '../stores/portfolio.store'
import { useSourcesStore } from '../stores/sources.store'
import { useTransactionsStore } from '../stores/transactions.store'
import { useTaxStore } from '../stores/tax.store'
import { useImportsStore } from '../stores/imports.store'
import { useMovementsStore } from '../stores/movements.store'
import { t } from '../i18n'

withDefaults(defineProps<{ variant?: 'header' | 'banner' }>(), { variant: 'header' })
const emit = defineEmits<{ switched: [] }>()

const store = usePortfoliosStore()
const router = useRouter()

async function switchTo(id: string) {
  const target = store.portfolios.find((p) => p.id === id)
  if (!target || target.id === store.active?.id) return
  store.setActive(target.isDefault ? null : id)
  // Clear scoped stores — the visible page reloads via its ionViewWillEnter
  // or the switched event
  usePortfolioStore().reset()
  useSourcesStore().reset()
  useTransactionsStore().reset()
  useTaxStore().reset()
  useImportsStore().reset()
  useMovementsStore().reset()
  emit('switched')
  const toast = await toastController.create({
    message: t('portfolios.switchedTo', { name: target.label }),
    duration: 1500,
    position: 'top',
  })
  await toast.present()
}

// One programmatic sheet instead of an inline one per page: Ionic keeps every
// visited page in the DOM, and several inline sheets raced each other.
// The guard only spans opening (double tap); a sheet that is still animating
// out must not block the next switch.
const opening = ref(false)
async function openSheet() {
  if (opening.value) return
  opening.value = true
  try {
    const sheet = await actionSheetController.create({
      header: t('portfolios.switchTitle'),
      buttons: buttons(),
    })
    await sheet.present()
  } finally {
    opening.value = false
  }
}

const buttons = () => [
  ...store.portfolios.map((p) => ({
    text: p.label,
    // Active entity: drawn icon + aria-current instead of a text glyph
    icon: p.id === store.active?.id ? checkmark : undefined,
    htmlAttributes: p.id === store.active?.id ? { 'aria-current': 'true' } : undefined,
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
]
</script>

<style scoped>
.banner-eyebrow {
  margin: 0;
  font-size: var(--app-text-xs);
  color: var(--app-ink-2);
}
.banner-name {
  margin: 0;
  font-weight: 600;
}
</style>
