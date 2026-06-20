<template>
  <div>
    <h1 class="text-2xl font-semibold mb-4">Dashboard</h1>
    <p v-if="error" class="text-red-600 mb-4">{{ error }}</p>

    <div v-if="o" class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
      <KpiCard label="Nutzer gesamt" :value="o.totalUsers" />
      <KpiCard label="Pro-Quote" :value="o.proRatePct + '%'" :sub="`${o.proUsers} Pro`" />
      <KpiCard label="Neu (7 Tage)" :value="o.newUsers7d" :sub="`${o.newUsers30d} in 30 Tagen`" />
      <KpiCard label="Aktive Abos" :value="o.activeSubscriptions" />
      <KpiCard label="MRR (Proxy)" :value="money(o.mrrProxyCents)" />
      <KpiCard label="Offene Payouts" :value="money(o.referral.owedCents)" :sub="`${o.referral.activeReferrers} Referrer`" />
      <KpiCard v-if="churn" label="Abgelaufene Pro" :value="churn.expiredPro" :sub="`${churn.expiringSoon7d} laufen bald ab`" />
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="lg:col-span-2 bg-white rounded-lg shadow-sm p-4">
        <h3 class="text-sm font-medium text-slate-600 mb-3">Neuregistrierungen (30 Tage)</h3>
        <Line v-if="growthData" :data="growthData" :options="lineOpts" />
      </div>
      <div class="bg-white rounded-lg shadow-sm p-4">
        <h3 class="text-sm font-medium text-slate-600 mb-3">Plan-Verteilung</h3>
        <Doughnut v-if="planData" :data="planData" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { Line, Doughnut } from 'vue-chartjs'
import type { AdminOverviewDto, AdminGrowthPointDto, AdminChurnDto } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import { money } from '../format'
import KpiCard from '../components/KpiCard.vue'

const o = ref<AdminOverviewDto | null>(null)
const growth = ref<AdminGrowthPointDto[]>([])
const churn = ref<AdminChurnDto | null>(null)
const error = ref('')
const lineOpts = { responsive: true, plugins: { legend: { display: false } } }

const growthData = computed(() =>
  growth.value.length
    ? {
        labels: growth.value.map((p) => p.date),
        datasets: [{ label: 'Signups', data: growth.value.map((p) => p.signups), borderColor: '#334155', tension: 0.3 }],
      }
    : null,
)
const planData = computed(() =>
  o.value
    ? {
        labels: ['Free', 'Pro'],
        datasets: [{ data: [o.value.freeUsers, o.value.proUsers], backgroundColor: ['#cbd5e1', '#334155'] }],
      }
    : null,
)

onMounted(async () => {
  try {
    o.value = await adminApi.overview()
    growth.value = (await adminApi.growth(30)).points
    churn.value = await adminApi.churn()
  } catch {
    error.value = 'Daten konnten nicht geladen werden.'
  }
})
</script>
