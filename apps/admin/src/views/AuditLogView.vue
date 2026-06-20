<template>
  <div>
    <h1 class="text-2xl font-semibold mb-4">Audit-Log</h1>
    <div class="flex gap-2 mb-4">
      <select v-model="action" class="rounded border border-slate-300 px-3 py-2 text-sm" @change="reload">
        <option value="">Alle Aktionen</option>
        <option v-for="a in actions" :key="a" :value="a">{{ a }}</option>
      </select>
    </div>

    <div class="bg-white rounded-lg shadow-sm overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-slate-500">
          <tr>
            <th class="px-4 py-2">Zeit</th>
            <th class="px-4 py-2">Admin</th>
            <th class="px-4 py-2">Aktion</th>
            <th class="px-4 py-2">Ziel</th>
            <th class="px-4 py-2">Details</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in data?.audit ?? []" :key="e.id" class="border-t border-slate-100">
            <td class="px-4 py-2 text-slate-500 whitespace-nowrap">{{ dt(e.createdAt) }}</td>
            <td class="px-4 py-2">{{ e.actorEmail }}</td>
            <td class="px-4 py-2"><span class="text-xs bg-slate-100 rounded px-1.5 py-0.5">{{ e.action }}</span></td>
            <td class="px-4 py-2 text-slate-500">{{ e.targetType }}<span v-if="e.targetId" class="font-mono text-xs"> · {{ e.targetId.slice(0, 8) }}</span></td>
            <td class="px-4 py-2 font-mono text-xs text-slate-400">{{ e.metadata ? JSON.stringify(e.metadata) : '' }}</td>
          </tr>
          <tr v-if="data && data.audit.length === 0"><td colspan="5" class="px-4 py-3 text-slate-400">Keine Einträge.</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="data" class="flex items-center justify-between mt-3 text-sm text-slate-500">
      <span>{{ data.total }} Einträge</span>
      <div class="flex gap-2">
        <button class="rounded border px-3 py-1 disabled:opacity-40" :disabled="page <= 1" @click="go(page - 1)">Zurück</button>
        <span class="px-2 py-1">Seite {{ page }}</span>
        <button class="rounded border px-3 py-1 disabled:opacity-40" :disabled="page * data.pageSize >= data.total" @click="go(page + 1)">Weiter</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AdminAuditListDto } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'

const data = ref<AdminAuditListDto | null>(null)
const action = ref('')
const page = ref(1)
const actions = [
  'USER_PLAN_CHANGED',
  'USER_DELETED',
  'USER_SESSIONS_REVOKED',
  'COMMISSION_VOIDED',
  'PAYOUT_SETTLED',
  'SYNC_TRIGGERED',
]

function dt(iso: string): string {
  return new Date(iso).toLocaleString('de-DE')
}
async function reload() {
  page.value = 1
  await load()
}
async function go(p: number) {
  page.value = p
  await load()
}
async function load() {
  data.value = await adminApi.audit({ action: action.value, page: page.value })
}
onMounted(load)
</script>
