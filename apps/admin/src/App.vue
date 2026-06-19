<template>
  <div v-if="isLogin" class="min-h-screen bg-slate-100">
    <RouterView />
  </div>
  <div v-else class="flex min-h-screen bg-slate-100 text-slate-800">
    <AppSidebar />
    <main class="flex-1 p-6 overflow-x-auto">
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppSidebar from './components/AppSidebar.vue'

const route = useRoute()
const isLogin = computed(() => route.name === 'login')
</script>
