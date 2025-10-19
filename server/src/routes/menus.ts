import Router from 'koa-router'
import { createMenu, deleteMenu, listMenus, updateMenu } from '@/controllers/menuController'
import { authMiddleware } from '@/middleware/auth'

const menuRouter = new Router({ prefix: '/api/menus' })

menuRouter.use(authMiddleware)
menuRouter.get('/', listMenus)
menuRouter.post('/', createMenu)
menuRouter.put('/:id', updateMenu)
menuRouter.delete('/:id', deleteMenu)

export default menuRouter
