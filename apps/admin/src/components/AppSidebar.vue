<template>
  <aside class="w-56 shrink-0 bg-slate-900 text-slate-200 min-h-screen flex flex-col">
    <div class="px-4 py-5 text-lg font-semibold text-white">Admin</div>
    <nav class="flex-1 px-2 space-y-1">
      <RouterLink
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        class="block rounded px-3 py-2 text-sm hover:bg-slate-800"
        active-class="bg-slate-800 text-white font-medium"
        :exact-active-class="link.to === '/' ? 'bg-slate-800 text-white font-medium' : ''"
      >
        {{ link.label }}
      </RouterLink>
    </nav>
    <div class="p-3 border-t border-slate-800 text-xs">
      <div class="truncate text-slate-400 mb-2">{{ auth.user?.email }}</div>
      <button class="w-full rounded bg-slate-800 px-3 py-2 hover:bg-slate-700" @click="onLogout">
        Abmelden
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.store'

const auth = useAuthStore()
const router = useRouter()

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/users', label: 'Users' },
  { to: '/referrals', label: 'Referrals' },
  { to: '/churn', label: 'Churn' },
  { to: '/sync-health', label: 'Sync-Health' },
  { to: '/sources', label: 'Sources' },
  { to: '/imports', label: 'CSV-Imports' },
  { to: '/assets', label: 'Assets' },
  { to: '/transactions', label: 'Transaktionen' },
  { to: '/price-cache', label: 'Preis-Cache' },
  { to: '/audit', label: 'Audit-Log' },
  { to: '/surveys', label: 'Umfragen' },
]

async function onLogout() {
  await auth.logout()
  router.push({ name: 'login' })
}
</script>
