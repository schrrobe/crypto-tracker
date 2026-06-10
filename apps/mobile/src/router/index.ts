import { createRouter, createWebHistory } from '@ionic/vue-router'
import type { RouteRecordRaw } from 'vue-router'
import TabsPage from '../views/TabsPage.vue'

const routes: Array<RouteRecordRaw> = [
  // Auth-Routen (Login/Register) kommen in Meilenstein 1 inkl. Guard
  {
    path: '/',
    redirect: '/tabs/dashboard',
  },
  {
    path: '/tabs/',
    component: TabsPage,
    children: [
      { path: '', redirect: '/tabs/dashboard' },
      { path: 'dashboard', component: () => import('../views/DashboardPage.vue') },
      { path: 'holdings', component: () => import('../views/HoldingsPage.vue') },
      { path: 'sources', component: () => import('../views/sources/SourcesPage.vue') },
      { path: 'settings', component: () => import('../views/SettingsPage.vue') },
    ],
  },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})
