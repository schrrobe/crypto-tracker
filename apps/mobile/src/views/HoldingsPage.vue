<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <PortfolioSwitcher @switched="loadData" />
        </ion-buttons>
        <ion-title>{{ $t('tabs.holdings') }}</ion-title>
        <ion-buttons slot="end">
          <ion-button
            data-testid="toggle-balances"
            :title="$t('common.toggleBalances')"
            @click="toggleBalances"
          >
            <ion-icon :icon="balancesHidden ? eyeOffOutline : eyeOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content :fullscreen="true">
      <LoadingSkeleton v-if="pageLoading && portfolio.holdings.length === 0" />
      <ErrorState v-else-if="pageError && portfolio.holdings.length === 0" @retry="loadData" />
      <template v-else-if="portfolio.holdings.length > 0">
      <ion-list v-for="group in groupedHoldings" :key="group.type" inset :data-testid="`holdings-group-${group.type}`">
        <ion-list-header>
          <ion-label>{{ $t(`holdings.accountType.${group.type}`) }}</ion-label>
          <ion-badge :color="badgeColor(group.type)" :data-testid="`holding-badge-${group.type}`">
            {{ $t(`holdings.accountType.${group.type}`) }}
          </ion-badge>
        </ion-list-header>
        <ion-item v-for="holding in group.items" :key="holding.id" :data-testid="`holding-${holding.asset.symbol}`">
          <ion-label>
            <h3>{{ holding.asset.symbol }}</h3>
            <p>
              {{ formatQuantity(holding.quantity) }} {{ holding.asset.symbol }} ·
              {{ holding.sourceLabel }}
            </p>
          </ion-label>
          <ion-note
            slot="end"
            class="amount"
            :class="{ negative: isNegative(holding.valueEur) }"
          >{{ formatCurrency(holding.valueEur, 'EUR') }}</ion-note>
          <ion-buttons slot="end">
            <ion-button
              v-if="holding.valueEur === null && holding.asset.coingeckoId === null"
              color="warning"
              :data-testid="`holding-map-${holding.asset.symbol}`"
              @click="openMapping(holding)"
            >
              <ion-icon :icon="pricetagOutline" slot="icon-only" />
            </ion-button>
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

      <FuturesPositionsList v-if="portfolio.futuresPositions.length > 0" />
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
      <AssetMappingModal
        :is-open="mappingOpen"
        :asset="mappingAsset"
        @close="mappingOpen = false"
        @saved="onMapped"
      />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  alertController,
  IonBadge,
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
  IonListHeader,
  IonNote,
  IonPage,
  IonTitle,
  IonToolbar,
  onIonViewWillEnter,
} from '@ionic/vue'
import {
  addOutline,
  createOutline,
  eyeOffOutline,
  eyeOutline,
  pricetagOutline,
  trashOutline,
} from 'ionicons/icons'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { HoldingAccountType, HoldingDto } from '@crypto-tracker/shared'
import AddHoldingModal from '../components/AddHoldingModal.vue'
import AssetMappingModal from '../components/AssetMappingModal.vue'
import FuturesPositionsList from '../components/FuturesPositionsList.vue'
import PortfolioSwitcher from '../components/PortfolioSwitcher.vue'
import LoadingSkeleton from '../components/LoadingSkeleton.vue'
import ErrorState from '../components/ErrorState.vue'
import { usePortfolioStore } from '../stores/portfolio.store'
import { t } from '../i18n'
import { formatCurrency, formatQuantity } from '../services/format'
import { balancesHidden, toggleBalances } from '../services/privacy'

const portfolio = usePortfolioStore()
const route = useRoute()
const router = useRouter()

const modalOpen = ref(false)
const editing = ref<HoldingDto | null>(null)
const pageLoading = ref(false)
const pageError = ref(false)
const showUnpriced = ref(false)
const mappingOpen = ref(false)
const mappingAsset = ref<HoldingDto['asset'] | null>(null)

function openMapping(holding: HoldingDto) {
  mappingAsset.value = holding.asset
  mappingOpen.value = true
}

async function onMapped() {
  await loadData()
  await usePortfolioStore().loadSummary()
}

// Spam-/unbekannte Tokens (ohne Preis) sind standardmäßig eingeklappt
const pricedHoldings = computed(() => portfolio.holdings.filter((h) => h.valueEur !== null))
const unpricedHoldings = computed(() => portfolio.holdings.filter((h) => h.valueEur === null))
const visibleHoldings = computed(() =>
  showUnpriced.value ? [...pricedHoldings.value, ...unpricedHoldings.value] : pricedHoldings.value,
)

// Nach Kontotyp gruppieren (feste Reihenfolge, leere Gruppen ausblenden)
const ACCOUNT_ORDER: HoldingAccountType[] = ['SPOT', 'EARN', 'MARGIN', 'FUTURES']
const groupedHoldings = computed(() =>
  ACCOUNT_ORDER.map((type) => ({
    type,
    items: visibleHoldings.value.filter((h) => h.accountType === type),
  })).filter((g) => g.items.length > 0),
)

function badgeColor(type: HoldingAccountType): string {
  return { SPOT: 'medium', EARN: 'success', MARGIN: 'warning', FUTURES: 'primary' }[type]
}
// negative Werte (Margin-Verbindlichkeit) rot — bei Privatsphäre-Maske unterdrückt
function isNegative(value: string | null): boolean {
  return !balancesHidden.value && value !== null && Number(value) < 0
}

async function loadData() {
  pageLoading.value = true
  pageError.value = false
  try {
    await Promise.all([portfolio.loadHoldings(), portfolio.loadFuturesPositions()])
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
.amount.negative {
  color: var(--app-color-loss, #dc2626);
}
</style>
