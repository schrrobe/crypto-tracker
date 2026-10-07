<template>
  <ion-page>
    <AppTopBar :title="asset?.symbol ?? '…'" back-href="/tabs/holdings" :show-switcher="false" :show-profile="false" />
    <ion-content>
      <div class="page">
        <LoadingSkeleton v-if="pageLoading && lines.length === 0" />
        <ErrorState v-else-if="pageError && lines.length === 0" @retry="loadData" />
        <section v-else-if="!asset" class="empty-state">
          <h2>{{ $t('tabs.holdings') }}</h2>
          <p>{{ $t('ui.asset.noHolding') }}</p>
        </section>
        <template v-else>
          <!-- Head: what it is, how much in total, what it is worth -->
          <header class="head">
            <AssetIcon :src="asset.iconUrl" :symbol="asset.symbol" :size="40" />
            <div class="head-text">
              <h2 class="asset-name">{{ asset.name }}</h2>
              <p class="fig total-qty" data-testid="asset-total-quantity">
                {{ formatQuantity(totalQuantity) }} {{ asset.symbol }}
              </p>
              <p class="facts">
                <span v-if="totalValue !== null" class="fig" data-testid="asset-total-value">{{ formatCurrency(totalValue, 'EUR') }}</span>
                <span v-if="price !== null">
                  · {{ $t('ui.asset.price') }} <span class="fig">{{ formatCurrencyRaw(price, 'EUR') }}</span>
                </span>
                <span v-if="share !== null"> · {{ $t('ui.asset.share', { pct: share }) }}</span>
              </p>
            </div>
          </header>

          <p v-if="totalValue === null" class="notice section-notice" role="note">
            <ion-icon :icon="alertCircleOutline" aria-hidden="true" />
            <span>{{ $t('ui.asset.unpriced') }}</span>
          </p>

          <!-- By source: the statement that adds up to the total -->
          <section class="section" aria-labelledby="by-source-title">
            <div class="section-head">
              <h2 id="by-source-title" class="section-title">{{ $t('ui.asset.perSource') }}</h2>
              <ion-button
                v-if="auth.user?.isAdmin && totalValue === null && asset.coingeckoId === null"
                size="small"
                fill="outline"
                :data-testid="`holding-map-${asset.symbol}`"
                @click="mappingOpen = true"
              >
                <ion-icon slot="start" :icon="pricetagOutline" aria-hidden="true" />
                {{ $t('ui.asset.mapPrice') }}
              </ion-button>
            </div>
            <div class="sheet">
              <ul class="stmt">
                <li v-for="h in lines" :key="h.id" class="line" :data-testid="`holding-line-${h.sourceLabel}`">
                  <div class="stmt-row line-row">
                    <span class="stmt-main">
                      <span class="stmt-label">{{ h.sourceLabel }}</span>
                      <span class="stmt-sub">
                        <span class="fig">{{ formatQuantity(h.quantity) }} {{ asset.symbol }}</span>
                        <span v-if="h.accountType !== 'SPOT'" class="tag">{{ $t(`holdings.accountType.${h.accountType}`) }}</span>
                      </span>
                    </span>
                    <span class="stmt-value fig amount" :class="{ negative: isNegative(h.valueEur) }">
                      {{ h.valueEur === null ? '–' : formatCurrency(h.valueEur, 'EUR') }}
                    </span>
                    <span class="actions">
                      <template v-if="h.sourceType === 'MANUAL'">
                        <ion-button
                          fill="clear"
                          :aria-label="$t('ui.asset.editLine', { symbol: asset.symbol, source: h.sourceLabel })"
                          :data-testid="`holding-edit-${asset.symbol}`"
                          @click="openEdit(h)"
                        >
                          <ion-icon slot="icon-only" :icon="createOutline" aria-hidden="true" />
                        </ion-button>
                        <ion-button
                          fill="clear"
                          color="danger"
                          :aria-label="$t('ui.asset.deleteLine', { symbol: asset.symbol, source: h.sourceLabel })"
                          :data-testid="`holding-delete-${asset.symbol}`"
                          @click="confirmDelete(h)"
                        >
                          <ion-icon slot="icon-only" :icon="trashOutline" aria-hidden="true" />
                        </ion-button>
                      </template>
                      <ion-button
                        v-else
                        fill="clear"
                        color="medium"
                        :aria-label="$t('holdings.notDeletableTitle')"
                        :data-testid="`holding-delete-info-${asset.symbol}`"
                        @click="showDeleteInfo(h)"
                      >
                        <ion-icon slot="icon-only" :icon="informationCircleOutline" aria-hidden="true" />
                      </ion-button>
                    </span>
                  </div>
                </li>
              </ul>
              <div class="stmt-total">
                <span>{{ $t('ui.asset.total') }}</span>
                <span class="total-cell">
                  <span class="fig">{{ formatQuantity(totalQuantity) }} {{ asset.symbol }}</span>
                  <span v-if="totalValue !== null" class="fig total-value">{{ formatCurrency(totalValue, 'EUR') }}</span>
                </span>
              </div>
            </div>
          </section>

          <!-- Movements of this asset, with the running quantity balance -->
          <section class="section" aria-labelledby="asset-movements-title">
            <div class="section-head">
              <h2 id="asset-movements-title" class="section-title">{{ $t('ui.asset.movements') }}</h2>
            </div>
            <div class="sheet">
              <p v-if="movements.loading && movements.groups.length === 0" class="pad muted">{{ $t('ui.state.loading') }} …</p>
              <p v-else-if="movements.groups.length === 0" class="pad muted">{{ $t('ui.overview.noMovements') }}</p>
              <MovementList
                v-else
                :groups="movements.groups"
                currency="EUR"
                :label="$t('ui.asset.movements')"
                :show-balance="true"
              />
            </div>
            <ion-button
              v-if="movements.hasMore"
              expand="block"
              fill="outline"
              class="more"
              @click="movements.loadMore()"
            >
              {{ $t('ui.movement.loadMore') }}
            </ion-button>
            <p class="hint">{{ $t('ui.movement.window', { days: movements.historyDays }) }}</p>
          </section>
        </template>
      </div>

      <AddHoldingModal :is-open="editOpen" :edit-holding="editing" @close="editOpen = false" @saved="loadData" />
      <AssetMappingModal :is-open="mappingOpen" :asset="asset" @close="mappingOpen = false" @saved="loadData" />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { alertController, IonButton, IonContent, IonIcon, IonPage, onIonViewWillEnter } from '@ionic/vue'
import {
  alertCircleOutline,
  createOutline,
  informationCircleOutline,
  pricetagOutline,
  trashOutline,
} from 'ionicons/icons'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { AssetDto, HoldingDto } from '@crypto-tracker/shared'
import AppTopBar from '../components/AppTopBar.vue'
import AssetIcon from '../components/AssetIcon.vue'
import MovementList from '../components/MovementList.vue'
import AddHoldingModal from '../components/AddHoldingModal.vue'
import AssetMappingModal from '../components/AssetMappingModal.vue'
import LoadingSkeleton from '../components/LoadingSkeleton.vue'
import ErrorState from '../components/ErrorState.vue'
import { usePortfolioStore } from '../stores/portfolio.store'
import { useMovementsStore } from '../stores/movements.store'
import { useAuthStore } from '../stores/auth.store'
import { formatCurrency, formatCurrencyRaw, formatQuantity, intlLocale } from '../services/format'
import { balancesHidden } from '../services/privacy'
import { t } from '../i18n'

const route = useRoute()
const router = useRouter()
const portfolio = usePortfolioStore()
const movements = useMovementsStore()
const auth = useAuthStore()

const pageLoading = ref(false)
const pageError = ref(false)
const editOpen = ref(false)
const editing = ref<HoldingDto | null>(null)
const mappingOpen = ref(false)

const assetId = computed(() => String(route.params.assetId ?? ''))
const lines = computed(() => portfolio.holdings.filter((h) => h.asset.id === assetId.value))
const asset = computed<AssetDto | null>(() => lines.value[0]?.asset ?? movements.groups[0]?.asset ?? null)

const totalQuantity = computed(() => String(lines.value.reduce((sum, h) => sum + Number(h.quantity), 0)))
const totalValue = computed(() => {
  const priced = lines.value.filter((h) => h.valueEur !== null)
  if (priced.length === 0) return null
  return priced.reduce((sum, h) => sum + Number(h.valueEur), 0).toFixed(2)
})
// Unit price derived from any priced line (all lines share the same rate)
const price = computed(() => {
  const h = lines.value.find((l) => l.valueEur !== null && Number(l.quantity) !== 0)
  return h ? String(Number(h.valueEur) / Number(h.quantity)) : null
})
const share = computed(() => {
  const total = Number(portfolio.summary?.totalEur ?? 0)
  if (totalValue.value === null || total <= 0) return null
  return new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 1 }).format(
    (Number(totalValue.value) / total) * 100,
  )
})

function isNegative(value: string | null): boolean {
  return !balancesHidden.value && value !== null && Number(value) < 0
}

async function loadData() {
  pageLoading.value = true
  pageError.value = false
  try {
    await Promise.all([portfolio.loadHoldings(), portfolio.loadSummary()])
  } catch {
    pageError.value = true
  } finally {
    pageLoading.value = false
  }
  void movements.load({ assetId: assetId.value })
}

function openEdit(h: HoldingDto) {
  editing.value = h
  editOpen.value = true
}

async function confirmDelete(h: HoldingDto) {
  const alert = await alertController.create({
    header: t('holdings.deleteTitle', { symbol: h.asset.symbol }),
    message: t('holdings.deleteMessage'),
    buttons: [
      { text: t('common.cancel'), role: 'cancel' },
      {
        text: t('common.delete'),
        role: 'destructive',
        handler: async () => {
          await portfolio.deleteHolding(h.sourceId, h.id)
          // Last line gone: nothing left to show here
          if (lines.value.length === 0) router.replace('/tabs/holdings')
          else void movements.load({ assetId: assetId.value })
        },
      },
    ],
  })
  await alert.present()
}

// Synced / CSV-derived holdings are recomputed from their source, so they cannot
// be deleted individually. Explain why and point to deleting the whole source.
async function showDeleteInfo(h: HoldingDto) {
  const alert = await alertController.create({
    header: t('holdings.notDeletableTitle'),
    message: t('holdings.notDeletableMessage', { source: h.sourceLabel }),
    buttons: [{ text: t('common.close'), role: 'cancel' }],
  })
  await alert.present()
}

onIonViewWillEnter(() => {
  void loadData()
})
</script>

<style scoped>
.head {
  display: flex;
  gap: var(--app-space-3);
  align-items: flex-start;
  padding-top: var(--app-space-2);
}
.head-text {
  min-width: 0;
}
.asset-name {
  margin: 0;
  font-size: var(--app-text-sm);
  font-weight: 600;
  color: var(--app-ink-2);
}
.total-qty {
  margin: 2px 0 0;
  font-size: var(--app-text-xl);
  font-weight: 600;
  white-space: normal;
  overflow-wrap: anywhere;
}
.facts {
  margin: var(--app-space-1) 0 0;
  font-size: var(--app-text-sm);
  color: var(--app-ink-2);
}
.line-row {
  grid-template-columns: minmax(0, 1fr) auto auto;
  padding-right: var(--app-space-1);
}
.line-row .stmt-sub {
  display: flex;
  flex-wrap: wrap;
  gap: var(--app-space-2);
  align-items: center;
}
.actions {
  display: flex;
}
.total-cell {
  display: grid;
  justify-items: end;
}
.total-value {
  font-size: var(--app-text-sm);
  font-weight: 500;
  color: var(--app-ink-2);
}
.pad {
  padding: var(--app-space-4);
  margin: 0;
}
.more {
  margin-top: var(--app-space-3);
}
.section-notice {
  margin-top: var(--app-space-4);
}
.section-notice ion-icon {
  flex: none;
  font-size: 1.125rem;
  color: var(--app-warn);
}
</style>
