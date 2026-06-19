<template>
  <div>
    <h1 class="text-2xl font-semibold mb-4">Quellen</h1>
    <div v-if="d">
      <KpiCard class="max-w-xs mb-4" label="Veraltet (>24h / nie)" :value="d.staleCount" />
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CountBars title="Nach Typ" :items="d.byType" />
        <CountBars title="Nach Provider" :items="d.byProvider" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminApi } from '../services/admin'
import KpiCard from '../components/KpiCard.vue'
import CountBars from '../components/CountBars.vue'

const d = ref<Awaited<ReturnType<typeof adminApi.sources>> | null>(null)
onMounted(async () => {
  d.value = await adminApi.sources()
})
</script>
