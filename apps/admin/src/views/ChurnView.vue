<template>
  <div>
    <h1 class="text-2xl font-semibold mb-4">Churn / Abos</h1>
    <div v-if="d" class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
      <KpiCard label="Aktive Pro" :value="d.activePro" />
      <KpiCard label="Abgelaufene Pro" :value="d.expiredPro" />
      <KpiCard label="Läuft in 7 Tagen ab" :value="d.expiringSoon7d" />
    </div>

    <div v-if="d" class="bg-white rounded-lg shadow-sm overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-slate-500">
          <tr><th class="px-4 py-2">E-Mail</th><th class="px-4 py-2">Abgelaufen am</th></tr>
        </thead>
        <tbody>
          <tr v-for="(l, i) in d.lapsed" :key="i" class="border-t border-slate-100">
            <td class="px-4 py-2">{{ l.email }}</td>
            <td class="px-4 py-2 text-slate-500">{{ date(l.planUntil) }}</td>
          </tr>
          <tr v-if="d.lapsed.length === 0"><td colspan="2" class="px-4 py-3 text-slate-400">Keine abgelaufenen Pro-Abos.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AdminChurnDto } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import { date } from '../format'
import KpiCard from '../components/KpiCard.vue'

const d = ref<AdminChurnDto | null>(null)
onMounted(async () => {
  d.value = await adminApi.churn()
})
</script>
