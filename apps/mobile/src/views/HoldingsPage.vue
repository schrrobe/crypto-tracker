<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ $t('tabs.holdings') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content :fullscreen="true">
      <LoadingSkeleton v-if="pageLoading && portfolio.holdings.length === 0" />
      <ErrorState v-else-if="pageError && portfolio.holdings.length === 0" @retry="loadData" />
      <template v-else-if="portfolio.holdings.length > 0">
      <ion-list inset>
        <ion-item v-for="holding in visibleHoldings" :key="holding.id" :data-testid="`holding-${holding.asset.symbol}`">
          <ion-label>
            <h3>{{ holding.asset.symbol }}</h3>
            <p>
              {{ formatQuantity(holding.quantity) }} {{ holding.asset.symbol }} ·
              {{ holding.sourceLabel }}
            </p>
          </ion-label>
          <ion-note slot="end" class="amount">{{ formatCurrency(holding.valueEur, 'EUR') }}</ion-note>
          <ion-buttons slot="end">
            <ion-button
              v-if="holding.sourceType === 'MANUAL'"
              :data-testid="`holding-edit-${holding.asset.symbol}`"
              @click="openEdit(holding)"
            >
              <ion-icon :icon="createOutline" slot="icon-only" />
            </ion-button>
            <ion-button
              v-if="holding.sourceType === 'MANUAL'"
              color="danger"
              :data-testid="`holding-delete-${holding.asset.symbol}`"
              @click="confirmDelete(holding)"
            >
              <ion-icon :icon="trashOutline" slot="icon-only" />
            </ion-button>
          </ion-buttons>
        </ion-item>
      </ion-list>

      <ion-button
        v-if="unpricedHoldings.length > 0"
        expand="block"
        fill="clear"
        size="small"
        data-testid="toggle-unpriced"
        @click="showUnpriced = !showUnpriced"
      >
        {{
          showUnpriced
            ? $t('holdings.hideUnpriced')
            : $t('holdings.showUnpriced', { n: unpricedHoldings.length })
        }}
      </ion-button>
      </template>

      <div v-else class="empty" data-testid="holdings-empty">
        <p>{{ $t('holdings.empty') }}</p>
      </div>

      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button data-testid="add-holding" @click="openAdd">
          <ion-icon :icon="addOutline" />
        </ion-fab-button>
      </ion-fab>

      <AddHoldingModal
        :is-open="modalOpen"
        :edit-holding="editing"
        @close="modalOpen = false"
      />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  alertController,
  IonButton,
  IonButtons,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonTitle,
  IonToolbar,
  onIonViewWillEnter,
} from '@ionic/vue'
import { addOutline, createOutline, trashOutline } from 'ionicons/icons'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { HoldingDto } from '@crypto-tracker/shared'
import AddHoldingModal from '../components/AddHoldingModal.vue'
import LoadingSkeleton from '../components/LoadingSkeleton.vue'
import ErrorState from '../components/ErrorState.vue'
import { usePortfolioStore } from '../stores/portfolio.store'
import { t } from '../i18n'
import { formatCurrency, formatQuantity } from '../services/format'

const portfolio = usePortfolioStore()
const route = useRoute()
const router = useRouter()

const modalOpen = ref(false)
const editing = ref<HoldingDto | null>(null)
const pageLoading = ref(false)
const pageError = ref(false)
const showUnpriced = ref(false)

// Spam-/unbekannte Tokens (ohne Preis) sind standardmäßig eingeklappt
const pricedHoldings = computed(() => portfolio.holdings.filter((h) => h.valueEur !== null))
const unpricedHoldings = computed(() => portfolio.holdings.filter((h) => h.valueEur === null))
const visibleHoldings = computed(() =>
  showUnpriced.value ? [...pricedHoldings.value, ...unpricedHoldings.value] : pricedHoldings.value,
)

async function loadData() {
  pageLoading.value = true
  pageError.value = false
  try {
    await portfolio.loadHoldings()
  } catch {
    pageError.value = true
  } finally {
    pageLoading.value = false
  }
}

function openAdd() {
  editing.value = null
  modalOpen.value = true
}

function openEdit(holding: HoldingDto) {
  editing.value = holding
  modalOpen.value = true
}

async function confirmDelete(holding: HoldingDto) {
  const alert = await alertController.create({
    header: t('holdings.deleteTitle', { symbol: holding.asset.symbol }),
    message: t('holdings.deleteMessage'),
    buttons: [
      { text: t('common.cancel'), role: 'cancel' },
      {
        text: t('common.delete'),
        role: 'destructive',
        handler: () => {
          portfolio.deleteHolding(holding.sourceId, holding.id)
        },
      },
    ],
  })
  await alert.present()
}

onIonViewWillEnter(() => {
  loadData()
  // Onboarding-Einstieg: /tabs/holdings?add=1 öffnet direkt das Erfassen-Modal
  if (route.query.add === '1') {
    openAdd()
    router.replace({ query: {} })
  }
})
</script>

<style scoped>
.empty {
  text-align: center;
  margin-top: 48px;
  color: var(--ion-color-medium);
}
</style>
