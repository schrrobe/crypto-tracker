<template>
  <div>
    <h1 class="text-2xl font-semibold mb-1">Referrals</h1>
    <p class="text-sm text-slate-500 mb-4">
      Belohnungsprogramm: kostenlose Pro-Tage, kein Bargeld. Diese Liste ist der Reward-Verlauf.
    </p>
    <p v-if="err" class="text-red-600 mb-3">{{ err }}</p>

    <section class="bg-white rounded-lg shadow-sm p-4">
      <h3 class="font-medium mb-3">Vergebene Belohnungen</h3>
      <table class="w-full text-sm">
        <thead class="text-left text-slate-500">
          <tr><th class="py-1">Empfänger</th><th>Art</th><th>Pro-Tage</th><th>Status</th><th>Datum</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rewards" :key="r.id" class="border-t border-slate-100">
            <td class="py-2">{{ r.userEmail }}</td>
            <td>{{ kindLabel[r.kind] }}</td>
            <td class="tabular-nums">{{ r.grantedDays }}</td>
            <td>
              <span v-if="r.voidedAt" class="text-red-500">storniert</span>
              <span v-else class="text-emerald-600">aktiv</span>
            </td>
            <td class="text-slate-500">{{ date(r.createdAt) }}</td>
          </tr>
          <tr v-if="rewards.length === 0">
            <td colspan="5" class="py-3 text-slate-400">Noch keine Belohnungen vergeben.</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AdminReferralRewardDto } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import { ApiError } from '../services/api.client'
import { date } from '../format'

const rewards = ref<AdminReferralRewardDto[]>([])
const err = ref('')

const kindLabel: Record<AdminReferralRewardDto['kind'], string> = {
  SIGNUP: 'Einladung (Signup)',
  CONVERSION: 'Pro-Konversion',
}

async function load() {
  err.value = ''
  try {
    rewards.value = (await adminApi.referralRewards()).rewards
  } catch (e) {
    err.value = e instanceof ApiError ? e.message : 'Fehler'
  }
}
onMounted(load)
</script>
