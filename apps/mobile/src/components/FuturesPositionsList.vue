<template>
  <ion-list inset data-testid="futures-list">
    <ion-list-header>
      <ion-label>{{ $t('futures.title') }}</ion-label>
    </ion-list-header>
    <ion-item
      v-for="p in portfolio.futuresPositions"
      :key="p.id"
      :data-testid="`futures-${p.assetSymbol}`"
    >
      <ion-label>
        <h3>
          {{ p.assetSymbol }}
          <ion-badge
            :color="p.side === 'LONG' ? 'success' : 'danger'"
            :data-testid="`futures-side-${p.assetSymbol}`"
          >
            {{ $t(`futures.side.${p.side}`) }}
          </ion-badge>
          <span v-if="p.leverage" class="lev">{{ $t('futures.leverage', { x: p.leverage }) }}</span>
        </h3>
        <p>
          {{ $t('futures.size') }}: {{ formatQuantity(p.size) }} {{ p.assetSymbol }}
          <template v-if="p.liquidationPrice">
            · {{ $t('futures.liq') }}: {{ formatCurrencyRaw(p.liquidationPrice, 'USD') }}
          </template>
        </p>
      </ion-label>
      <ion-note slot="end" class="end">
        <span class="notional">{{ formatCurrency(p.valueEur, 'EUR') }}</span>
        <span
          class="upnl"
          :class="{ negative: isNegative(p.unrealizedPnlEur), positive: isPositive(p.unrealizedPnlEur) }"
          :data-testid="`futures-pnl-${p.assetSymbol}`"
        >
          {{ formatCurrency(p.unrealizedPnlEur, 'EUR') }}
        </span>
      </ion-note>
    </ion-item>
  </ion-list>
</template>

<script setup lang="ts">
import { IonBadge, IonItem, IonLabel, IonList, IonListHeader, IonNote } from '@ionic/vue'
import { usePortfolioStore } from '../stores/portfolio.store'
import { formatCurrency, formatCurrencyRaw, formatQuantity } from '../services/format'
import { balancesHidden } from '../services/privacy'

const portfolio = usePortfolioStore()

// uPnL green/red — no color when the privacy mask is on (don't let the sign leak)
function isNegative(value: string | null): boolean {
  return !balancesHidden.value && value !== null && Number(value) < 0
}
function isPositive(value: string | null): boolean {
  return !balancesHidden.value && value !== null && Number(value) > 0
}
</script>

<style scoped>
.lev {
  margin-left: 6px;
  font-size: 0.8em;
  color: var(--ion-color-medium);
}
.end {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.upnl.negative {
  color: var(--app-color-loss, #dc2626);
}
.upnl.positive {
  color: var(--app-color-gain, #16a34a);
}
</style>
