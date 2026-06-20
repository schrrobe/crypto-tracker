<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-semibold">Dashboard</h1>
      <div class="flex items-center gap-3 text-sm text-slate-500">
        <span v-if="lastUpdated">aktualisiert {{ lastUpdated }}</span>
        <button class="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50" @click="loadAll">
          Aktualisieren
        </button>
      </div>
    </div>
    <p v-if="error" class="text-red-600 mb-4">{{ error }}</p>

    <HealthBadges :data="health" />
    <AttentionPanel :data="attention" />

    <div v-if="o" class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
      <KpiCard label="Nutzer gesamt" :value="o.totalUsers" />
      <KpiCard label="Pro-Quote" :value="o.proRatePct + '%'" :sub="`${o.proUsers} Pro`" />
      <KpiCard label="Neu (7 Tage)" :value="o.newUsers7d" :delta="o.newUsers7dDeltaPct" sub="vs. Vorwoche" />
      <KpiCard label="Neu (30 Tage)" :value="o.newUsers30d" :delta="o.newUsers30dDeltaPct" sub="vs. Vormonat" />
      <KpiCard label="Aktive Sessions" :value="o.activeSessions" />
      <KpiCard label="Aktive Abos" :value="o.activeSubscriptions" />
      <KpiCard label="MRR (Proxy)" :value="money(o.mrrProxyCents)" />
      <KpiCard label="Offene Payouts" :value="money(o.referral.owedCents)" :sub="`${o.referral.activeReferrers} Referrer`" />
      <KpiCard v-if="churn" label="Abgelaufene Pro" :value="churn.expiredPro" :sub="`${churn.expiringSoon7d} laufen bald ab`" />
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
      <div class="lg:col-span-2 bg-white rounded-lg shadow-sm p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-medium text-slate-600">Neuregistrierungen</h3>
          <div class="flex gap-1">
            <button
              v-for="d in ranges"
              :key="d"
              class="text-xs rounded px-2 py-1"
              :class="d === range ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'"
              @click="setRange(d)"
            >
              {{ d }}T
            </button>
          </div>
        </div>
        <Line v-if="growthData" :data="growthData" :options="lineOpts" />
      </div>
      <div class="bg-white rounded-lg shadow-sm p-4">
        <h3 class="text-sm font-medium text-slate-600 mb-3">Plan-Verteilung</h3>
        <Doughnut v-if="planData" :data="planData" />
      </div>
    </div>

    <!-- Activity feed -->
    <div v-if="activity" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="bg-white rounded-lg shadow-sm p-4">
        <h3 class="text-sm font-medium text-slate-600 mb-3">Letzte Registrierungen</h3>
        <ul class="text-sm">
          <li
            v-for="s in activity.recentSignups"
            :key="s.id"
            class="flex justify-between border-t border-slate-100 py-2 first:border-t-0 cursor-pointer hover:bg-slate-50"
            @click="$router.push(`/users/${s.id}`)"
          >
            <span class="truncate">{{ s.email }}</span>
            <span class="text-slate-400 whitespace-nowrap ml-2">{{ s.plan }} · {{ dt(s.createdAt) }}</span>
          </li>
          <li v-if="activity.recentSignups.length === 0" class="py-2 text-slate-400">Keine.</li>
        </ul>
      </div>
      <div class="bg-white rounded-lg shadow-sm p-4">
        <h3 class="text-sm font-medium text-slate-600 mb-3">Letzte Admin-Aktionen</h3>
        <ul class="text-sm">
          <li v-for="a in activity.recentAudit" :key="a.id" class="border-t border-slate-100 py-2 first:border-t-0">
            <span class="text-xs bg-slate-100 rounded px-1.5 py-0.5">{{ a.action }}</span>
            <span class="text-slate-500 ml-2">{{ a.actorEmail }}</span>
            <span class="text-slate-400 ml-2">{{ dt(a.createdAt) }}</span>
          </li>
          <li v-if="activity.recentAudit.length === 0" class="py-2 text-slate-400">Keine.</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue'
import { Line, Doughnut } from 'vue-chartjs'
import type {
  AdminOverviewDto,
  AdminGrowthPointDto,
  AdminChurnDto,
  AdminActivityDto,
  AdminAttentionDto,
  AdminHealthDto,
} from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import { money } from '../format'
import KpiCard from '../components/KpiCard.vue'
import AttentionPanel from '../components/AttentionPanel.vue'
import HealthBadges from '../components/HealthBadges.vue'

const o = ref<AdminOverviewDto | null>(null)
const growth = ref<AdminGrowthPointDto[]>([])
const churn = ref<AdminChurnDto | null>(null)
const activity = ref<AdminActivityDto | null>(null)
const attention = ref<AdminAttentionDto | null>(null)
const health = ref<AdminHealthDto | null>(null)
const lastUpdated = ref('')
const error = ref('')
const ranges = [7, 30, 90]
const range = ref(30)
const lineOpts = { responsive: true, plugins: { legend: { display: false } } }

function dt(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE')
}

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

async function setRange(d: number) {
  range.value = d
  growth.value = (await adminApi.growth(d)).points
}

async function loadAll() {
  try {
    const [ov, gr, ch, ac, at, he] = await Promise.all([
      adminApi.overview(),
      adminApi.growth(range.value),
      adminApi.churn(),
      adminApi.activity(),
      adminApi.attention(),
      adminApi.health(),
    ])
    o.value = ov
    growth.value = gr.points
    churn.value = ch
    activity.value = ac
    attention.value = at
    health.value = he
    error.value = ''
    lastUpdated.value = new Date().toLocaleTimeString('de-DE')
  } catch {
    // Keep previous values on a failed refresh; only flag on initial load.
    if (!o.value) error.value = 'Daten konnten nicht geladen werden.'
  }
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void loadAll()
  timer = setInterval(loadAll, 60_000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>
