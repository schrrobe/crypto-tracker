<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Dashboard</ion-title>
        <ion-buttons slot="end">
          <ion-button data-testid="refresh-button" :disabled="portfolio.loading" @click="refresh">
            <ion-spinner v-if="portfolio.loading" name="crescent" />
            <ion-icon v-else :icon="refreshOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content :fullscreen="true">
      <ion-refresher slot="fixed" @ionRefresh="onPullRefresh">
        <ion-refresher-content />
      </ion-refresher>

      <ion-card button data-testid="total-value-card" @click="toggleCurrency">
        <ion-card-header>
          <ion-card-subtitle>Gesamtwert ({{ currency }})</ion-card-subtitle>
          <ion-card-title class="amount total" data-testid="total-value">
            {{ totalFormatted }}
          </ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <p class="muted">
            Preise: {{ formatRelativeTime(portfolio.summary?.pricesFetchedAt ?? null) }} ·
            Tippen für {{ currency === 'EUR' ? 'USD' : 'EUR' }}
          </p>
        </ion-card-content>
      </ion-card>

      <ion-list v-if="topAssets.length > 0" inset>
        <ion-list-header>
          <ion-label>Top-Positionen</ion-label>
        </ion-list-header>
        <ion-item v-for="position in topAssets" :key="position.asset.id">
          <ion-label>
            <h3>{{ position.asset.symbol }}</h3>
            <p>{{ formatQuantity(position.quantity) }} {{ position.asset.symbol }}</p>
          </ion-label>
          <ion-note slot="end" class="amount">
            {{ formatCurrency(currency === 'EUR' ? position.valueEur : position.valueUsd, currency) }}
          </ion-note>
        </ion-item>
      </ion-list>

      <div v-else class="empty" data-testid="dashboard-empty">
        <p>Noch keine Bestände.</p>
        <ion-button router-link="/tabs/holdings" fill="outline">Bestand erfassen</ion-button>
      </div>

      <ion-text v-if="(portfolio.summary?.unmappedAssets.length ?? 0) > 0" color="warning">
        <p class="ion-padding-horizontal">
          {{ portfolio.summary?.unmappedAssets.length }} Asset(s) ohne Preis-Mapping — Werte unvollständig.
        </p>
      </ion-text>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  onIonViewWillEnter,
  type RefresherCustomEvent,
} from '@ionic/vue'
import { refreshOutline } from 'ionicons/icons'
import { computed, ref } from 'vue'
import { usePortfolioStore } from '../stores/portfolio.store'
import { useAuthStore } from '../stores/auth.store'
import { formatCurrency, formatQuantity, formatRelativeTime } from '../services/format'

const portfolio = usePortfolioStore()
const auth = useAuthStore()

const currency = ref<'EUR' | 'USD'>((auth.user?.baseCurrency as 'EUR' | 'USD') ?? 'EUR')

const totalFormatted = computed(() => {
  const s = portfolio.summary
  if (!s) return '…'
  return formatCurrency(currency.value === 'EUR' ? s.totalEur : s.totalUsd, currency.value)
})

const topAssets = computed(() => (portfolio.summary?.byAsset ?? []).slice(0, 5))

function toggleCurrency() {
  currency.value = currency.value === 'EUR' ? 'USD' : 'EUR'
}

async function refresh() {
  await portfolio.refresh()
}

async function onPullRefresh(event: RefresherCustomEvent) {
  await portfolio.refresh()
  await event.target.complete()
}

onIonViewWillEnter(() => {
  portfolio.loadSummary()
})
</script>

<style scoped>
.total {
  font-size: 2.2rem;
}
.muted {
  color: var(--ion-color-medium);
  font-size: 0.85em;
}
.empty {
  text-align: center;
  margin-top: 48px;
  color: var(--ion-color-medium);
}
</style>
