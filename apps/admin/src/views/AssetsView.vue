<template>
  <div>
    <h1 class="text-2xl font-semibold mb-4">Assets & Holdings</h1>
    <KpiCard v-if="d" class="max-w-xs mb-4" label="Distinct Assets (gehalten)" :value="d.distinctAssets" />
    <div v-if="d" class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <CountBars title="Top-Assets (nach Holdings)" :items="d.topAssets" />
      <CountBars title="Nach Kontotyp" :items="d.byAccountType" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AdminAssetsDto } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import KpiCard from '../components/KpiCard.vue'
import CountBars from '../components/CountBars.vue'

const d = ref<AdminAssetsDto | null>(null)
onMounted(async () => {
  d.value = await adminApi.assets()
})
</script>
