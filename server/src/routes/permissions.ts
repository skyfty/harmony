import Router from 'koa-router'
import {
  createPermission,
  deletePermission,
  listPermissions,
  updatePermission,
} from '@/controllers/admin/adminPermissionController'
import { requireAdminAuth } from '@/middleware/authDomains'
import { requireAnyPermission } from '@/middleware/permission'

const permissionRouter = new Router({ prefix: '/api/permissions' })

permissionRouter.use(requireAdminAuth)
permissionRouter.get('/', requireAnyPermission(['permission:read']), listPermissions)
permissionRouter.post('/', requireAnyPermission(['permission:write']), createPermission)
permissionRouter.put('/:id', requireAnyPermission(['permission:write']), updatePermission)
permissionRouter.delete('/:id', requireAnyPermission(['permission:write']), deletePermission)

export default permissionRouter
