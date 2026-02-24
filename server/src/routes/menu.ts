import Router from 'koa-router'
import { requireAdminAuth } from '@/middleware/authDomains'
import { listBackendMenus } from '@/controllers/admin/menuController'

const menuRouter = new Router({ prefix: '/api/menu' })

menuRouter.use(requireAdminAuth)
menuRouter.get('/all', listBackendMenus)

export default menuRouter
