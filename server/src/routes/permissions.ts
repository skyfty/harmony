import Router from 'koa-router'
import {
  createPermission,
  deletePermission,
  listPermissions,
  updatePermission,
} from '@/controllers/permissionController'
import { authMiddleware } from '@/middleware/auth'
import { requireAnyPermission } from '@/middleware/permission'

const permissionRouter = new Router({ prefix: '/api/permissions' })

permissionRouter.use(authMiddleware)
permissionRouter.get('/', requireAnyPermission(['permission:read']), listPermissions)
permissionRouter.post('/', requireAnyPermission(['permission:write']), createPermission)
permissionRouter.put('/:id', requireAnyPermission(['permission:write']), updatePermission)
permissionRouter.delete('/:id', requireAnyPermission(['permission:write']), deletePermission)

export default permissionRouter
