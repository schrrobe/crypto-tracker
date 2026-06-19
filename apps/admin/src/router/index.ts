import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '../stores/auth.store'

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
  { path: '/', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
  { path: '/users', name: 'users', component: () => import('../views/UsersView.vue') },
  { path: '/users/:id', name: 'user-detail', component: () => import('../views/UserDetailView.vue') },
  { path: '/referrals', name: 'referrals', component: () => import('../views/ReferralsView.vue') },
  { path: '/sync-health', name: 'sync-health', component: () => import('../views/SyncHealthView.vue') },
  { path: '/sources', name: 'sources', component: () => import('../views/SourcesView.vue') },
  { path: '/imports', name: 'imports', component: () => import('../views/ImportsView.vue') },
  { path: '/assets', name: 'assets', component: () => import('../views/AssetsView.vue') },
  { path: '/transactions', name: 'transactions', component: () => import('../views/TransactionsView.vue') },
  { path: '/price-cache', name: 'price-cache', component: () => import('../views/PriceCacheView.vue') },
]

export const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.init()
  if (to.meta.public) {
    if (auth.user?.isAdmin) return { name: 'dashboard' }
    return true
  }
  // Protected: must be an admin user.
  if (!auth.user) return { name: 'login' }
  if (!auth.user.isAdmin) {
    await auth.logout()
    return { name: 'login', query: { denied: '1' } }
  }
  return true
})
