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
      @click="open = true"
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
      @click="open = true"
    >
      {{ store.active?.label ?? '…' }}
      <ion-icon :icon="chevronDownOutline" slot="end" />
    </ion-button>
  </template>

  <ion-action-sheet
    :is-open="open"
    :header="$t('portfolios.switchTitle')"
    :buttons="buttons"
    @didDismiss="open = false"
  />
</template>

<script setup lang="ts">
import {
  IonActionSheet,
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonNote,
  toastController,
} from '@ionic/vue'
import { briefcaseOutline, chevronDownOutline } from 'ionicons/icons'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { usePortfoliosStore } from '../stores/portfolios.store'
import { usePortfolioStore } from '../stores/portfolio.store'
import { useSourcesStore } from '../stores/sources.store'
import { useTransactionsStore } from '../stores/transactions.store'
import { useTaxStore } from '../stores/tax.store'
import { useImportsStore } from '../stores/imports.store'
import { t } from '../i18n'

withDefaults(defineProps<{ variant?: 'header' | 'banner' }>(), { variant: 'header' })
const emit = defineEmits<{ switched: [] }>()

const store = usePortfoliosStore()
const router = useRouter()
const open = ref(false)

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
  emit('switched')
  const toast = await toastController.create({
    message: t('portfolios.switchedTo', { name: target.label }),
    duration: 1500,
    position: 'top',
  })
  await toast.present()
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

<style scoped>
.banner-eyebrow {
  margin: 0;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ion-color-medium);
}
.banner-name {
  margin: 0;
  font-weight: 600;
}
</style>
