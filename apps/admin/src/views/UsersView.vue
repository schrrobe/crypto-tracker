<template>
  <div>
    <h1 class="text-2xl font-semibold mb-4">Nutzer</h1>
    <div class="flex gap-2 mb-4">
      <input
        v-model="search"
        placeholder="E-Mail suchen…"
        class="rounded border border-slate-300 px-3 py-2 text-sm"
        @keyup.enter="reload"
      />
      <select v-model="plan" class="rounded border border-slate-300 px-3 py-2 text-sm" @change="reload">
        <option value="">Alle Pläne</option>
        <option value="FREE">Free</option>
        <option value="PRO">Pro</option>
      </select>
      <button class="rounded bg-slate-900 text-white px-4 py-2 text-sm" @click="reload">Suchen</button>
    </div>

    <div class="bg-white rounded-lg shadow-sm overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-slate-500">
          <tr>
            <th class="px-4 py-2">E-Mail</th>
            <th class="px-4 py-2">Plan</th>
            <th class="px-4 py-2">Quellen</th>
            <th class="px-4 py-2">Eingeladen von</th>
            <th class="px-4 py-2">Registriert</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="u in data?.users ?? []"
            :key="u.id"
            class="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
            @click="$router.push(`/users/${u.id}`)"
          >
            <td class="px-4 py-2">
              {{ u.email }}
              <span v-if="u.isAdmin" class="ml-1 text-xs bg-amber-100 text-amber-700 rounded px-1">admin</span>
              <span v-if="u.suspendedAt" class="ml-1 text-xs bg-red-100 text-red-700 rounded px-1">gesperrt</span>
            </td>
            <td class="px-4 py-2">
              <span :class="u.plan === 'PRO' ? 'text-emerald-600 font-medium' : 'text-slate-500'">{{ u.plan }}</span>
            </td>
            <td class="px-4 py-2">{{ u.sourcesCount }}</td>
            <td class="px-4 py-2 text-slate-500">{{ u.referredByEmail ?? '–' }}</td>
            <td class="px-4 py-2 text-slate-500">{{ date(u.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="data" class="flex items-center justify-between mt-3 text-sm text-slate-500">
      <span>{{ data.total }} Nutzer</span>
      <div class="flex gap-2">
        <button class="rounded border px-3 py-1 disabled:opacity-40" :disabled="page <= 1" @click="go(page - 1)">Zurück</button>
        <span class="px-2 py-1">Seite {{ page }}</span>
        <button class="rounded border px-3 py-1 disabled:opacity-40" :disabled="page * data.pageSize >= data.total" @click="go(page + 1)">Weiter</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AdminUserListDto } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import { date } from '../format'

const data = ref<AdminUserListDto | null>(null)
const search = ref('')
const plan = ref('')
const page = ref(1)

async function reload() {
  page.value = 1
  await load()
}
async function go(p: number) {
  page.value = p
  await load()
}
async function load() {
  data.value = await adminApi.users({ search: search.value, plan: plan.value, page: page.value })
}
onMounted(load)
</script>
