import { createRouter, createWebHistory } from '@ionic/vue-router'
import type { RouteRecordRaw } from 'vue-router'
import TabsPage from '../views/TabsPage.vue'
import { useAuthStore } from '../stores/auth.store'

const routes: Array<RouteRecordRaw> = [
  { path: '/', redirect: '/tabs/dashboard' },
  { path: '/login', component: () => import('../views/auth/LoginPage.vue'), meta: { guestOnly: true } },
  { path: '/register', component: () => import('../views/auth/RegisterPage.vue'), meta: { guestOnly: true } },
  {
    path: '/forgot-password',
    component: () => import('../views/auth/ForgotPasswordPage.vue'),
    meta: { guestOnly: true },
  },
  {
    path: '/reset-password',
    component: () => import('../views/auth/ResetPasswordPage.vue'),
    meta: { guestOnly: true },
  },
  {
    path: '/tabs/',
    component: TabsPage,
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: '/tabs/dashboard' },
      { path: 'dashboard', component: () => import('../views/DashboardPage.vue') },
      { path: 'holdings', component: () => import('../views/HoldingsPage.vue') },
      { path: 'market', component: () => import('../views/MarketPage.vue') },
      { path: 'sources', component: () => import('../views/sources/SourcesPage.vue') },
      { path: 'sources/imports', component: () => import('../views/sources/csv/ImportsPage.vue') },
      { path: 'sources/transactions', component: () => import('../views/transactions/TransactionsPage.vue') },
      { path: 'settings', component: () => import('../views/SettingsPage.vue') },
      { path: 'settings/tax-report', component: () => import('../views/tax/TaxReportPage.vue') },
    ],
  },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.initialized) await auth.init()

  if (to.meta.requiresAuth && !auth.user) return '/login'
  if (to.meta.guestOnly && auth.user) return '/tabs/dashboard'
  return true
})
