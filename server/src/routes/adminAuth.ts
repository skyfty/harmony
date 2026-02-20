import Router from 'koa-router'
import { adminLogin, adminLogout, adminProfile } from '@/controllers/adminAuthController'
import { requireAdminAuth } from '@/middleware/authDomains'

const adminAuthRouter = new Router({ prefix: '/api/admin-auth' })

adminAuthRouter.post('/login', adminLogin)
adminAuthRouter.get('/profile', requireAdminAuth, adminProfile)
adminAuthRouter.post('/logout', requireAdminAuth, adminLogout)

export default adminAuthRouter
