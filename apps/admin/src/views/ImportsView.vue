<template>
  <div>
    <h1 class="text-2xl font-semibold mb-4">CSV-Imports</h1>
    <div v-if="d" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <KpiCard label="Zeilen gesamt" :value="d.totalRows" />
      <KpiCard label="Importiert" :value="d.importedRows" />
      <KpiCard label="Fehlerhaft" :value="d.errorRows" />
      <KpiCard label="Erfolgsquote" :value="successRate + '%'" />
    </div>
    <CountBars v-if="d" title="Nach Status" :items="d.byStatus" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AdminImportsDto } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import KpiCard from '../components/KpiCard.vue'
import CountBars from '../components/CountBars.vue'

const d = ref<AdminImportsDto | null>(null)
const successRate = computed(() =>
  d.value && d.value.totalRows > 0 ? Math.round((d.value.importedRows / d.value.totalRows) * 1000) / 10 : 0,
)
onMounted(async () => {
  d.value = await adminApi.imports()
})
</script>
