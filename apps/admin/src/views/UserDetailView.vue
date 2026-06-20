<template>
  <div v-if="u">
    <RouterLink to="/users" class="text-sm text-slate-500">← Nutzer</RouterLink>
    <h1 class="text-2xl font-semibold mt-2 mb-4">
      {{ u.email }}
      <span v-if="u.isAdmin" class="align-middle ml-2 text-xs bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">admin</span>
      <span v-if="u.suspendedAt" class="align-middle ml-2 text-xs bg-red-100 text-red-700 rounded px-1.5 py-0.5">gesperrt</span>
    </h1>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <KpiCard label="Plan" :value="u.plan" :sub="u.planUntil ? 'bis ' + date(u.planUntil) : ''" />
      <KpiCard label="Portfolios" :value="u.portfoliosCount" :sub="`${u.sourcesCount} Quellen`" />
      <KpiCard label="Holdings" :value="u.holdingsCount" />
      <KpiCard label="Aktive Sessions" :value="u.activeSessions" />
      <KpiCard label="Eingeladen" :value="u.invitedCount" />
      <KpiCard label="Einnahmen offen" :value="earnings(u.earnings, 'owedCents')" />
      <KpiCard label="Ausgezahlt" :value="earnings(u.earnings, 'paidCents')" />
      <KpiCard label="Eingeladen von" :value="u.referredByEmail ?? '–'" />
    </div>

    <div class="bg-white rounded-lg shadow-sm p-4 space-y-4 max-w-xl">
      <h3 class="font-medium">Aktionen</h3>
      <p v-if="msg" class="text-sm text-emerald-600">{{ msg }}</p>
      <p v-if="err" class="text-sm text-red-600">{{ err }}</p>

      <div class="flex items-center gap-2">
        <select v-model="planChoice" class="rounded border border-slate-300 px-3 py-2 text-sm">
          <option value="FREE">FREE</option>
          <option value="PRO">PRO</option>
        </select>
        <button class="rounded bg-slate-900 text-white px-3 py-2 text-sm" @click="changePlan">Plan setzen</button>
      </div>

      <button class="rounded border border-slate-300 px-3 py-2 text-sm" @click="revoke">Sessions widerrufen</button>

      <button
        v-if="!u.suspendedAt"
        class="rounded border border-amber-300 text-amber-700 px-3 py-2 text-sm block"
        @click="toggleSuspend(true)"
      >
        Konto sperren
      </button>
      <button
        v-else
        class="rounded border border-emerald-300 text-emerald-700 px-3 py-2 text-sm block"
        @click="toggleSuspend(false)"
      >
        Sperre aufheben
      </button>

      <button class="rounded border border-slate-300 px-3 py-2 text-sm block" @click="toggleAdmin">
        {{ u.isAdmin ? 'Admin-Rechte entziehen' : 'Zum Admin machen' }}
      </button>

      <button class="rounded border border-red-300 text-red-600 px-3 py-2 text-sm block" @click="remove">
        Konto löschen
      </button>
    </div>

    <div class="bg-white rounded-lg shadow-sm p-4 mt-6">
      <h3 class="font-medium mb-3">Quellen & Sync</h3>
      <p v-if="sources.length === 0" class="text-sm text-slate-400">Keine Quellen.</p>
      <div v-for="s in sources" :key="s.id" class="border-t border-slate-100 py-3 first:border-t-0">
        <div class="flex items-center justify-between">
          <div>
            <span class="font-medium">{{ s.label }}</span>
            <span class="text-xs text-slate-400 ml-2">{{ s.provider ?? s.type }}</span>
            <span class="text-xs text-slate-400 ml-2">letzter Sync: {{ s.lastSyncAt ? dt(s.lastSyncAt) : '–' }}</span>
          </div>
          <button
            class="rounded bg-slate-900 text-white px-3 py-1 text-xs disabled:opacity-50"
            :disabled="syncing === s.id"
            @click="triggerSync(s.id)"
          >
            {{ syncing === s.id ? '…' : 'Jetzt syncen' }}
          </button>
        </div>
        <div class="mt-1 flex gap-1 flex-wrap">
          <span
            v-for="r in s.recentRuns"
            :key="r.id"
            class="text-xs rounded px-1.5 py-0.5"
            :class="r.status === 'SUCCESS' ? 'bg-emerald-100 text-emerald-700' : r.status === 'ERROR' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'"
            :title="r.errorMessage ?? ''"
          >
            {{ r.status }}<span v-if="r.errorCode"> · {{ r.errorCode }}</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import type { AdminUserDetailDto, AdminSourceDto } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import { ApiError } from '../services/api.client'
import { earnings, date } from '../format'
import KpiCard from '../components/KpiCard.vue'

const route = useRoute()
const router = useRouter()
const id = route.params.id as string
const u = ref<AdminUserDetailDto | null>(null)
const sources = ref<AdminSourceDto[]>([])
const syncing = ref<string | null>(null)
const planChoice = ref<'FREE' | 'PRO'>('FREE')
const msg = ref('')
const err = ref('')

function dt(iso: string): string {
  return new Date(iso).toLocaleString('de-DE')
}

async function load() {
  u.value = await adminApi.user(id)
  planChoice.value = u.value.plan
  await loadSources()
}
async function loadSources() {
  sources.value = (await adminApi.userSources(id)).sources
}
async function triggerSync(sourceId: string) {
  err.value = msg.value = ''
  syncing.value = sourceId
  try {
    const { queued } = await adminApi.triggerSync(sourceId)
    // Queued runs finish in the worker → refetch after a short delay.
    if (queued) await new Promise((r) => setTimeout(r, 1500))
    await loadSources()
    msg.value = 'Sync ausgelöst.'
  } catch (e) {
    flash(e)
  } finally {
    syncing.value = null
  }
}
function flash(e: unknown) {
  err.value = e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'
}

async function changePlan() {
  err.value = msg.value = ''
  try {
    await adminApi.updatePlan(id, {
      plan: planChoice.value,
      planUntil: planChoice.value === 'PRO' ? new Date(Date.now() + 31536000000).toISOString() : null,
    })
    await load()
    msg.value = 'Plan aktualisiert.'
  } catch (e) {
    flash(e)
  }
}
async function revoke() {
  err.value = msg.value = ''
  try {
    const { revoked } = await adminApi.revokeSessions(id)
    msg.value = `${revoked} Sessions widerrufen.`
    await load()
  } catch (e) {
    flash(e)
  }
}
async function toggleSuspend(suspend: boolean) {
  err.value = msg.value = ''
  try {
    if (suspend) await adminApi.suspend(id)
    else await adminApi.unsuspend(id)
    msg.value = suspend ? 'Konto gesperrt.' : 'Sperre aufgehoben.'
    await load()
  } catch (e) {
    flash(e)
  }
}
async function toggleAdmin() {
  err.value = msg.value = ''
  try {
    await adminApi.setAdmin(id, !u.value!.isAdmin)
    await load()
    msg.value = 'Admin-Rolle aktualisiert.'
  } catch (e) {
    flash(e)
  }
}
async function remove() {
  if (!confirm('Konto wirklich löschen? Das ist unwiderruflich.')) return
  err.value = msg.value = ''
  try {
    await adminApi.deleteUser(id)
    router.push('/users')
  } catch (e) {
    flash(e)
  }
}
onMounted(load)
</script>
