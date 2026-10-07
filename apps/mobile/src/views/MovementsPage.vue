<template>
  <ion-page>
    <AppTopBar :title="$t('ui.overview.allMovements')" back-href="/tabs/dashboard" :show-profile="false" />
    <ion-content>
      <ion-refresher slot="fixed" @ionRefresh="onPullRefresh">
        <ion-refresher-content />
      </ion-refresher>
      <div class="page">
        <LoadingSkeleton v-if="movements.loading && movements.groups.length === 0" :count="6" />
        <ErrorState v-else-if="movements.error && movements.groups.length === 0" @retry="load" />
        <div v-else-if="movements.groups.length === 0" class="empty-state">
          <h2>{{ $t('ui.overview.movements') }}</h2>
          <p>{{ $t('ui.overview.noMovements') }}</p>
        </div>
        <template v-else>
          <div class="sheet">
            <MovementList
              :groups="movements.groups"
              :currency="currency"
              :label="$t('ui.overview.allMovements')"
              :with-balance="true"
              :is-fresh="movements.isFresh"
            />
          </div>
          <ion-button
            v-if="movements.hasMore"
            expand="block"
            fill="outline"
            class="more"
            :disabled="movements.loading"
            data-testid="movements-load-more"
            @click="movements.loadMore()"
          >
            {{ $t('ui.movement.loadMore') }}
          </ion-button>
        </template>
        <p class="hint">
          {{ $t('ui.movement.window', { days: movements.historyDays }) }}
          <button v-if="movements.historyDays < 365" type="button" class="inline-link" @click="openPaywall('history1y')">
            {{ $t('ui.movement.windowPro') }}
          </button>
        </p>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonContent,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  onIonViewWillEnter,
  type RefresherCustomEvent,
} from '@ionic/vue'
import { ref } from 'vue'
import AppTopBar from '../components/AppTopBar.vue'
import MovementList from '../components/MovementList.vue'
import LoadingSkeleton from '../components/LoadingSkeleton.vue'
import ErrorState from '../components/ErrorState.vue'
import { useMovementsStore } from '../stores/movements.store'
import { useAuthStore } from '../stores/auth.store'
import { openPaywall } from '../services/paywall'

const movements = useMovementsStore()
const auth = useAuthStore()
const currency = ref<'EUR' | 'USD'>((auth.user?.baseCurrency as 'EUR' | 'USD') ?? 'EUR')

async function load() {
  await movements.load()
}

async function onPullRefresh(event: RefresherCustomEvent) {
  await load()
  await event.target.complete()
}

onIonViewWillEnter(() => {
  currency.value = (auth.user?.baseCurrency as 'EUR' | 'USD') ?? 'EUR'
  void load()
})
</script>

<style scoped>
.more {
  margin-top: var(--app-space-4);
}
</style>
