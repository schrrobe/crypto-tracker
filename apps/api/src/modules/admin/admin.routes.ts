import { Router } from 'express'
import { requireAdmin } from '../../middleware/auth.middleware'
import { adminStatsRoutes } from './admin.stats.routes'
import { adminUsersRoutes } from './admin.users.routes'
import { adminReferralRoutes } from './admin.referral.routes'

// All admin endpoints require an authenticated user with isAdmin (else 404).
export const adminRoutes = Router()
adminRoutes.use(requireAdmin)

adminRoutes.use('/stats', adminStatsRoutes)
adminRoutes.use('/users', adminUsersRoutes)
adminRoutes.use('/referral', adminReferralRoutes)
