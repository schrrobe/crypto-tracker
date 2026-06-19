<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <form class="w-full max-w-sm bg-white rounded-lg shadow p-6 space-y-4" @submit.prevent="onSubmit">
      <h1 class="text-xl font-semibold text-slate-800">Admin-Login</h1>
      <p v-if="denied" class="text-sm text-amber-600">Kein Admin-Zugang für dieses Konto.</p>
      <div>
        <label class="block text-sm text-slate-600 mb-1">E-Mail</label>
        <input v-model="email" type="email" required class="w-full rounded border border-slate-300 px-3 py-2" />
      </div>
      <div>
        <label class="block text-sm text-slate-600 mb-1">Passwort</label>
        <input v-model="password" type="password" required class="w-full rounded border border-slate-300 px-3 py-2" />
      </div>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <button
        type="submit"
        :disabled="loading"
        class="w-full rounded bg-slate-900 text-white py-2 hover:bg-slate-800 disabled:opacity-50"
      >
        {{ loading ? '…' : 'Anmelden' }}
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.store'
import { ApiError } from '../services/api.client'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')
const denied = computed(() => route.query.denied === '1')

async function onSubmit() {
  error.value = ''
  loading.value = true
  try {
    await auth.login(email.value, password.value)
    if (!auth.user?.isAdmin) {
      await auth.logout()
      error.value = 'Kein Admin-Zugang für dieses Konto.'
      return
    }
    router.push({ name: 'dashboard' })
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Anmeldung fehlgeschlagen'
  } finally {
    loading.value = false
  }
}
</script>
