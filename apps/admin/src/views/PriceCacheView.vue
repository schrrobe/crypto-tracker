<template>
  <div>
    <h1 class="text-2xl font-semibold mb-4">Preis-Cache</h1>
    <div v-if="d" class="grid grid-cols-2 md:grid-cols-3 gap-3">
      <KpiCard label="Gecachte Assets" :value="d.cachedAssets" />
      <KpiCard label="Veraltet (>1h)" :value="d.staleCount" />
      <KpiCard label="Historische Zeilen" :value="d.historicalRows" />
      <KpiCard label="Ältester Abruf" :value="dt(d.oldestFetchedAt)" />
      <KpiCard label="Neuester Abruf" :value="dt(d.newestFetchedAt)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AdminPriceCacheDto } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import KpiCard from '../components/KpiCard.vue'

const d = ref<AdminPriceCacheDto | null>(null)
function dt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('de-DE') : '–'
}
onMounted(async () => {
  d.value = await adminApi.priceCache()
})
</script>
