<template>
  <div v-if="u">
    <RouterLink to="/users" class="text-sm text-slate-500">← Nutzer</RouterLink>
    <h1 class="text-2xl font-semibold mt-2 mb-4">{{ u.email }}</h1>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <KpiCard label="Plan" :value="u.plan" :sub="u.planUntil ? 'bis ' + date(u.planUntil) : ''" />
      <KpiCard label="Portfolios" :value="u.portfoliosCount" :sub="`${u.sourcesCount} Quellen`" />
      <KpiCard label="Holdings" :value="u.holdingsCount" />
      <KpiCard label="Aktive Sessions" :value="u.activeSessions" />
      <KpiCard label="Eingeladen" :value="u.invitedCount" />
      <KpiCard label="Einnahmen offen" :value="money(u.earnings.owedCents, u.earnings.currency)" />
      <KpiCard label="Ausgezahlt" :value="money(u.earnings.paidCents, u.earnings.currency)" />
      <KpiCard label="Eingeladen von" :value="u.referredByEmail ?? '–'" />
    </div>

    <div class="bg-white rounded-lg shadow-sm p-4 space-y-4 max-w-xl">
      <h3 class="font-medium">Aktionen</h3>
      <p v-if="msg" class="text-sm text-emerald-600">{{ msg }}</p>
      <p v-if="err" class="text-sm text-red-600">{{ err }}</p>

      <div class="flex items-center gap-2">
        <select v-model="planChoice" class="rounded border border-slate-300 px-3 py-2 text-sm">
          <option value="FREE">FREE</option>
          <option value="PRO">PRO</option>
        </select>
        <button class="rounded bg-slate-900 text-white px-3 py-2 text-sm" @click="changePlan">Plan setzen</button>
      </div>

      <button class="rounded border border-slate-300 px-3 py-2 text-sm" @click="revoke">Sessions widerrufen</button>

      <button class="rounded border border-red-300 text-red-600 px-3 py-2 text-sm block" @click="remove">
        Konto löschen
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import type { AdminUserDetailDto } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import { ApiError } from '../services/api.client'
import { money, date } from '../format'
import KpiCard from '../components/KpiCard.vue'

const route = useRoute()
const router = useRouter()
const id = route.params.id as string
const u = ref<AdminUserDetailDto | null>(null)
const planChoice = ref<'FREE' | 'PRO'>('FREE')
const msg = ref('')
const err = ref('')

async function load() {
  u.value = await adminApi.user(id)
  planChoice.value = u.value.plan
}
function flash(e: unknown) {
  err.value = e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'
}

async function changePlan() {
  err.value = msg.value = ''
  try {
    await adminApi.updatePlan(id, {
      plan: planChoice.value,
      planUntil: planChoice.value === 'PRO' ? new Date(Date.now() + 31536000000).toISOString() : null,
    })
    await load()
    msg.value = 'Plan aktualisiert.'
  } catch (e) {
    flash(e)
  }
}
async function revoke() {
  err.value = msg.value = ''
  try {
    const { revoked } = await adminApi.revokeSessions(id)
    msg.value = `${revoked} Sessions widerrufen.`
    await load()
  } catch (e) {
    flash(e)
  }
}
async function remove() {
  if (!confirm('Konto wirklich löschen? Das ist unwiderruflich.')) return
  err.value = msg.value = ''
  try {
    await adminApi.deleteUser(id)
    router.push('/users')
  } catch (e) {
    flash(e)
  }
}
onMounted(load)
</script>
