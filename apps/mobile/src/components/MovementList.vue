<template>
  <ol class="stmt" :aria-label="label">
    <template v-for="day in days" :key="day.key">
      <li class="stmt-day" aria-hidden="true">{{ day.label }}</li>
      <li v-for="g in day.groups" :key="rowKey(g)">
        <!-- In the asset view the line already is the destination: no self-link -->
        <component
          :is="showBalance ? 'div' : RouterLink"
          class="stmt-row stmt-row--icon"
          :class="{ 'is-fresh': fresh(g) }"
          :to="showBalance ? undefined : `/tabs/holdings/asset/${g.asset.id}`"
          :aria-label="describe(g, day.label)"
          :role="showBalance ? 'group' : undefined"
          :data-testid="`movement-${g.asset.symbol}`"
        >
          <AssetIcon :src="g.asset.iconUrl" :symbol="g.asset.symbol" />
          <span class="stmt-main">
            <span class="stmt-label">
              <template v-if="showBalance">{{ g.sourceLabel }}</template>
              <template v-else>{{ g.asset.symbol }}<template v-if="showSource"> · {{ g.sourceLabel }}</template></template>
            </span>
            <span class="stmt-sub">
              {{ kindLabel(g) }} · {{ $t(`ui.movement.origin.${g.origin}`) }}
              <template v-if="g.accountType !== 'SPOT'"> · {{ $t(`holdings.accountType.${g.accountType}`) }}</template>
              <template v-if="g.count > 1"> · {{ $t('ui.movement.count', { n: g.count }) }}</template>
            </span>
          </span>
          <span class="stmt-value">
            <span class="fig">{{ signedQty(g) }}</span>
            <i18n-t v-if="showBalance" keypath="ui.movement.balanceAfter" tag="span" class="stmt-sub" scope="global">
              <template #qty><span class="fig">{{ formatQuantity(g.quantityAfter) }}</span></template>
            </i18n-t>
            <span v-else class="stmt-sub fig">{{ value(g) }}</span>
            <i18n-t v-if="withBalance" keypath="ui.movement.balanceAfter" tag="span" class="stmt-sub" scope="global">
              <template #qty><span class="fig">{{ formatQuantity(g.quantityAfter) }}</span></template>
            </i18n-t>
          </span>
        </component>
      </li>
    </template>
  </ol>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { MovementGroupDto } from '@crypto-tracker/shared'
import AssetIcon from './AssetIcon.vue'
import { formatCurrency, formatQuantity } from '../services/format'
import { balancesHidden, BALANCE_MASK } from '../services/privacy'
import { intlLocale, t } from '../i18n'

const props = withDefaults(
  defineProps<{
    groups: MovementGroupDto[]
    currency: 'EUR' | 'USD'
    label: string
    showSource?: boolean
    // Asset detail: the running quantity balance replaces the booking value
    showBalance?: boolean
    // Full list: running quantity balance in addition to the booking value
    withBalance?: boolean
    isFresh?: (g: MovementGroupDto) => boolean
  }>(),
  { showSource: true, showBalance: false, withBalance: false, isFresh: undefined },
)

function rowKey(g: MovementGroupDto): string {
  return `${g.day}|${g.sourceId}|${g.asset.id}|${g.accountType}|${g.kind}|${g.origin}`
}

function dayLabel(day: string): string {
  const today = new Date()
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (day === iso(today)) return t('ui.movement.today')
  const y = new Date(today)
  y.setDate(y.getDate() - 1)
  if (day === iso(y)) return t('ui.movement.yesterday')
  const [yy, mm, dd] = day.split('-').map(Number)
  const date = new Date(yy!, mm! - 1, dd!)
  return date.toLocaleDateString(intlLocale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: yy === today.getFullYear() ? undefined : 'numeric',
  })
}

const days = computed(() => {
  const out: Array<{ key: string; label: string; groups: MovementGroupDto[] }> = []
  for (const g of props.groups) {
    const last = out.at(-1)
    if (last && last.key === g.day) last.groups.push(g)
    else out.push({ key: g.day, label: dayLabel(g.day), groups: [g] })
  }
  return out
})

function fresh(g: MovementGroupDto): boolean {
  return props.isFresh ? props.isFresh(g) : false
}

function kindLabel(g: MovementGroupDto): string {
  if (g.kind === 'OPENING') return t('ui.movement.opening')
  return Number(g.delta) >= 0 ? t('ui.movement.in') : t('ui.movement.out')
}


function signedQty(g: MovementGroupDto): string {
  if (balancesHidden.value) return BALANCE_MASK
  const n = Number(g.delta)
  const abs = formatQuantity(String(Math.abs(n)))
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${abs} ${g.asset.symbol}`
}

function value(g: MovementGroupDto): string {
  const v = props.currency === 'EUR' ? g.valueEur : g.valueUsd
  if (v === null) return '–'
  return formatCurrency(String(Math.abs(Number(v))), props.currency)
}

function describe(g: MovementGroupDto, day: string): string {
  const parts = [day, kindLabel(g), signedQty(g).replace('−', '-'), g.sourceLabel]
  if (!props.showBalance) parts.push(value(g))
  if (g.count > 1) parts.push(t('ui.movement.count', { n: g.count }))
  return parts.join(', ')
}
</script>

<style scoped>
.stmt-row--icon {
  grid-template-columns: 24px minmax(0, 1fr) auto;
}
.stmt-value .stmt-sub {
  color: var(--app-ink-2);
}
</style>
