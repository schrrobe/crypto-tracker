<template>
  <div>
    <h1 class="text-2xl font-semibold mb-4">Transaktionen (30 Tage)</h1>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="lg:col-span-2 bg-white rounded-lg shadow-sm p-4">
        <h3 class="text-sm font-medium text-slate-600 mb-3">Aktivität / Tag</h3>
        <Bar v-if="barData" :data="barData" :options="opts" />
      </div>
      <CountBars title="Nach Typ" :items="byType" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Bar } from 'vue-chartjs'
import { adminApi } from '../services/admin'
import CountBars from '../components/CountBars.vue'

const perDay = ref<{ date: string; count: number }[]>([])
const byType = ref<{ key: string; count: number }[]>([])
const opts = { responsive: true, plugins: { legend: { display: false } } }
const barData = computed(() =>
  perDay.value.length
    ? { labels: perDay.value.map((p) => p.date), datasets: [{ label: 'Tx', data: perDay.value.map((p) => p.count), backgroundColor: '#334155' }] }
    : null,
)
onMounted(async () => {
  const d = await adminApi.transactions(30)
  perDay.value = d.perDay
  byType.value = d.byType
})
</script>
