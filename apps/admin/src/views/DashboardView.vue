<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-semibold">Dashboard</h1>
      <div class="flex items-center gap-3 text-sm text-slate-500">
        <span v-if="stale" class="rounded bg-amber-100 text-amber-700 px-2 py-0.5" role="status">
          Daten veraltet
        </span>
        <span v-if="lastUpdated">aktualisiert {{ lastUpdated }}</span>
        <button class="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50" @click="loadAll">
          Aktualisieren
        </button>
      </div>
    </div>
    <p v-if="error" class="text-red-600 mb-4" role="alert">{{ error }}</p>

    <HealthBadges :data="health" />
    <AttentionPanel :data="attention" />

    <!-- Loading skeleton on first load (no data yet) -->
    <div v-if="loading && !o" class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6" aria-hidden="true">
      <div v-for="n in 6" :key="n" class="bg-white rounded-lg shadow-sm p-4 animate-pulse">
        <div class="h-3 w-20 bg-slate-200 rounded"></div>
        <div class="h-6 w-16 bg-slate-200 rounded mt-3"></div>
      </div>
    </div>

    <template v-if="o">
      <!-- PRIMARY tier: the three numbers an admin should read first -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <KpiCard label="Nutzer gesamt" :value="o.totalUsers" />
        <KpiCard label="Neu (30 Tage)" :value="o.newUsers30d" :delta="o.newUsers30dDeltaPct" sub="vs. Vormonat" />
        <KpiCard label="MRR (Proxy)" :value="money(o.mrrProxyCents)" />
      </div>
      <!-- SECONDARY tier -->
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
        <KpiCard label="Pro-Quote" :value="o.proRatePct + '%'" :sub="`${o.proUsers} Pro`" />
        <KpiCard label="Aktive Abos" :value="o.activeSubscriptions" />
        <KpiCard label="Neu (7 Tage)" :value="o.newUsers7d" :delta="o.newUsers7dDeltaPct" sub="vs. Vorwoche" />
      </div>
      <!-- SYSTEM strip: de-emphasised operational counters -->
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6 opacity-90">
        <KpiCard label="Aktive Sessions" :value="o.activeSessions" />
        <KpiCard label="Offene Payouts" :value="earnings(o.referral.byCurrency, 'owedCents')" :sub="`${o.referral.activeReferrers} Referrer`" />
        <KpiCard
          v-if="churn"
          label="Abgelaufene Pro"
          :value="churn.expiredPro"
          :sub="`${churn.expiringSoon7d} laufen bald ab`"
          polarity="up-bad"
        />
      </div>
    </template>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
      <div class="lg:col-span-2 bg-white rounded-lg shadow-sm p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-medium text-slate-600">Neuregistrierungen</h3>
          <div class="flex gap-1" role="group" aria-label="Zeitraum der Wachstumskurve">
            <button
              v-for="d in ranges"
              :key="d"
              type="button"
              class="text-xs rounded px-3 py-2 min-w-11"
              :class="d === range ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'"
              :aria-pressed="d === range"
              :aria-label="`Zeitraum ${d} Tage`"
              @click="setRange(d)"
            >
              {{ d }}T
            </button>
          </div>
        </div>
        <Line v-if="growthData" :data="growthData" :options="lineOpts" />
        <p v-else-if="!loading" class="text-sm text-slate-400 py-8 text-center">Noch keine Registrierungen.</p>
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
            class="border-t border-slate-100 first:border-t-0"
          >
            <RouterLink
              :to="`/users/${s.id}`"
              class="flex justify-between py-2 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400 rounded"
            >
              <span class="truncate">{{ s.email }}</span>
              <span class="text-slate-500 whitespace-nowrap ml-2">{{ s.plan }} · {{ dt(s.createdAt) }}</span>
            </RouterLink>
          </li>
          <li v-if="activity.recentSignups.length === 0" class="py-2 text-slate-400">Keine.</li>
        </ul>
      </div>
      <div class="bg-white rounded-lg shadow-sm p-4">
        <h3 class="text-sm font-medium text-slate-600 mb-3">Letzte Admin-Aktionen</h3>
        <ul class="text-sm">
          <li v-for="a in activity.recentAudit" :key="a.id" class="flex items-center border-t border-slate-100 py-2 first:border-t-0">
            <span class="text-xs bg-slate-100 rounded px-1.5 py-0.5 whitespace-nowrap">{{ a.action }}</span>
            <span class="text-slate-600 ml-2 truncate">{{ a.actorEmail }}</span>
            <span class="text-slate-500 ml-auto pl-2 whitespace-nowrap">{{ dtTime(a.createdAt) }}</span>
          </li>
          <li v-if="activity.recentAudit.length === 0" class="py-2 text-slate-400">Keine.</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
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
import { money, earnings } from '../format'
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
const loading = ref(false)
const stale = ref(false)
const ranges = [7, 30, 90]
const range = ref(30)
const lineOpts = { responsive: true, plugins: { legend: { display: false } } }

function dt(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE')
}
function dtTime(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
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
  loading.value = true
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
    stale.value = false
    lastUpdated.value = new Date().toLocaleTimeString('de-DE')
  } catch {
    // Keep previous values on a failed refresh; flag on initial load (no data
    // yet → error banner) or surface a "stale" badge once data exists.
    if (!o.value) error.value = 'Daten konnten nicht geladen werden.'
    else stale.value = true
  } finally {
    loading.value = false
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
