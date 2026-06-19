<template>
  <div>
    <h1 class="text-2xl font-semibold mb-4">Sync-Health (7 Tage)</h1>
    <div v-if="d" class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
      <KpiCard label="Erfolgreich" :value="d.success" />
      <KpiCard label="Fehler" :value="d.error" />
      <KpiCard label="Fehlerquote" :value="rate + '%'" />
    </div>
    <div v-if="d" class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <CountBars title="Läufe je Provider" :items="d.byProvider" />
      <CountBars title="Top-Fehlercodes" :items="d.topErrorCodes" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AdminSyncHealthDto } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import KpiCard from '../components/KpiCard.vue'
import CountBars from '../components/CountBars.vue'

const d = ref<AdminSyncHealthDto | null>(null)
const rate = computed(() => {
  if (!d.value) return 0
  const total = d.value.success + d.value.error
  return total === 0 ? 0 : Math.round((d.value.error / total) * 1000) / 10
})
onMounted(async () => {
  d.value = await adminApi.syncHealth(7)
})
</script>
