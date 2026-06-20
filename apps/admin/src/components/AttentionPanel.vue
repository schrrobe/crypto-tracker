<template>
  <div class="bg-white rounded-lg shadow-sm p-4 mb-6">
    <h3 class="text-sm font-medium text-slate-600 mb-3">Needs attention</h3>
    <div v-if="active.length === 0" class="flex items-center gap-2 text-sm text-emerald-600">
      <span class="h-2.5 w-2.5 rounded-full bg-emerald-500" />
      Alles im grünen Bereich.
    </div>
    <ul v-else class="divide-y divide-slate-100">
      <li
        v-for="item in active"
        :key="item.key"
        class="flex items-center justify-between py-2 cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded"
        @click="$router.push(item.to)"
      >
        <span class="flex items-center gap-2 text-sm">
          <span class="h-2.5 w-2.5 rounded-full" :class="dot[item.severity]" />
          {{ item.label }}
        </span>
        <span class="flex items-center gap-2">
          <span class="text-sm font-semibold tabular-nums" :class="text[item.severity]">{{ item.count }}</span>
          <span class="text-slate-300">›</span>
        </span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AdminAttentionDto } from '@crypto-tracker/shared'

const props = defineProps<{ data: AdminAttentionDto | null }>()

type Severity = 'red' | 'amber' | 'neutral'
const dot: Record<Severity, string> = { red: 'bg-red-500', amber: 'bg-amber-500', neutral: 'bg-slate-400' }
const text: Record<Severity, string> = { red: 'text-red-600', amber: 'text-amber-600', neutral: 'text-slate-600' }

const defs: { key: keyof AdminAttentionDto; label: string; severity: Severity; to: string }[] = [
  { key: 'sourcesInError', label: 'Quellen im Fehlerstatus', severity: 'red', to: '/sync-health' },
  { key: 'failedImports', label: 'Fehlgeschlagene CSV-Imports', severity: 'red', to: '/imports' },
  { key: 'pendingPayouts', label: 'Offene Auszahlungen', severity: 'amber', to: '/referrals' },
  { key: 'stalePriceCache', label: 'Veralteter Preis-Cache', severity: 'amber', to: '/price-cache' },
  { key: 'expiringSoonPro', label: 'Pro läuft bald ab', severity: 'amber', to: '/churn' },
  { key: 'suspendedUsers', label: 'Gesperrte Konten', severity: 'neutral', to: '/users' },
]

const active = computed(() =>
  props.data ? defs.map((d) => ({ ...d, count: props.data![d.key] })).filter((d) => d.count > 0) : [],
)
</script>
