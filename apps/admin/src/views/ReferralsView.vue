<template>
  <div>
    <h1 class="text-2xl font-semibold mb-4">Referrals</h1>
    <p v-if="err" class="text-red-600 mb-3">{{ err }}</p>
    <p v-if="msg" class="text-emerald-600 mb-3">{{ msg }}</p>

    <section class="bg-white rounded-lg shadow-sm p-4 mb-6">
      <h3 class="font-medium mb-3">Offene Auszahlungen</h3>
      <table class="w-full text-sm">
        <thead class="text-left text-slate-500">
          <tr><th class="py-1">Referrer</th><th>IBAN</th><th>Inhaber</th><th>Offen</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="p in pending" :key="p.referrerId" class="border-t border-slate-100">
            <td class="py-2">{{ p.email }}</td>
            <td class="font-mono text-xs">{{ p.iban ?? '–' }}</td>
            <td>{{ p.holder ?? '–' }}</td>
            <td>{{ money(p.owedCents, p.currency) }}</td>
            <td class="text-right">
              <button class="rounded bg-slate-900 text-white px-3 py-1 text-xs" @click="settle(p.referrerId, p.currency)">
                Abrechnen
              </button>
            </td>
          </tr>
          <tr v-if="pending.length === 0"><td colspan="5" class="py-3 text-slate-400">Keine offenen Auszahlungen.</td></tr>
        </tbody>
      </table>
    </section>

    <section class="bg-white rounded-lg shadow-sm p-4 mb-6">
      <h3 class="font-medium mb-3">Kommissionen</h3>
      <table class="w-full text-sm">
        <thead class="text-left text-slate-500">
          <tr><th class="py-1">Referrer</th><th>Betrag</th><th>Status</th><th>Datum</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="c in commissions" :key="c.id" class="border-t border-slate-100">
            <td class="py-2">{{ c.referrerEmail }}</td>
            <td>{{ money(c.amountCents, c.currency) }}</td>
            <td>
              <span v-if="c.voidedAt" class="text-red-500">storniert</span>
              <span v-else-if="c.payoutId" class="text-emerald-600">ausgezahlt</span>
              <span v-else class="text-slate-500">offen</span>
            </td>
            <td class="text-slate-500">{{ date(c.createdAt) }}</td>
            <td class="text-right">
              <button
                v-if="!c.payoutId && !c.voidedAt"
                class="rounded border border-red-300 text-red-600 px-2 py-1 text-xs"
                @click="voidIt(c.id)"
              >
                Stornieren
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="bg-white rounded-lg shadow-sm p-4">
      <h3 class="font-medium mb-3">Auszahlungs-Historie</h3>
      <table class="w-full text-sm">
        <thead class="text-left text-slate-500"><tr><th class="py-1">Referrer</th><th>Betrag</th><th>Datum</th></tr></thead>
        <tbody>
          <tr v-for="h in history" :key="h.id" class="border-t border-slate-100">
            <td class="py-2">{{ h.referrerEmail }}</td>
            <td>{{ money(h.amountCents, h.currency) }}</td>
            <td class="text-slate-500">{{ date(h.createdAt) }}</td>
          </tr>
          <tr v-if="history.length === 0"><td colspan="3" class="py-3 text-slate-400">Noch keine Auszahlungen.</td></tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AdminCommissionDto } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import { ApiError } from '../services/api.client'
import { money, date } from '../format'

type Pending = Awaited<ReturnType<typeof adminApi.pendingPayouts>>['payouts']
type History = Awaited<ReturnType<typeof adminApi.payoutHistory>>['payouts']

const pending = ref<Pending>([])
const commissions = ref<AdminCommissionDto[]>([])
const history = ref<History>([])
const err = ref('')
const msg = ref('')

async function load() {
  ;[pending.value, commissions.value, history.value] = await Promise.all([
    adminApi.pendingPayouts().then((r) => r.payouts),
    adminApi.commissions().then((r) => r.commissions),
    adminApi.payoutHistory().then((r) => r.payouts),
  ])
}
async function settle(referrerId: string, currency: string) {
  err.value = msg.value = ''
  try {
    await adminApi.settlePayout(referrerId, currency)
    msg.value = 'Auszahlung verbucht.'
    await load()
  } catch (e) {
    err.value = e instanceof ApiError ? e.message : 'Fehler'
  }
}
async function voidIt(id: string) {
  err.value = msg.value = ''
  try {
    await adminApi.voidCommission(id)
    await load()
  } catch (e) {
    err.value = e instanceof ApiError ? e.message : 'Fehler'
  }
}
onMounted(load)
</script>
