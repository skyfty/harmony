import Router from 'koa-router'
import {
  createPermission,
  deletePermission,
  listPermissions,
  updatePermission,
} from '@/controllers/permissionController'
import { authMiddleware } from '@/middleware/auth'

const permissionRouter = new Router({ prefix: '/api/permissions' })

permissionRouter.use(authMiddleware)
permissionRouter.get('/', listPermissions)
permissionRouter.post('/', createPermission)
permissionRouter.put('/:id', updatePermission)
permissionRouter.delete('/:id', deletePermission)

export default permissionRouter
