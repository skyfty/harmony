import Router from 'koa-router'
import {
  createRole,
  deleteRole,
  getRole,
  listPermissionOptions,
  listRoles,
  updateRole,
} from '@/controllers/roleController'
import { authMiddleware } from '@/middleware/auth'
import { requireAnyPermission } from '@/middleware/permission'

const roleRouter = new Router({ prefix: '/api/roles' })

roleRouter.use(authMiddleware)
roleRouter.get('/', requireAnyPermission(['role:read']), listRoles)
roleRouter.get('/options/permissions', requireAnyPermission(['role:read']), listPermissionOptions)
roleRouter.get('/:id', requireAnyPermission(['role:read']), getRole)
roleRouter.post('/', requireAnyPermission(['role:write']), createRole)
roleRouter.put('/:id', requireAnyPermission(['role:write']), updateRole)
roleRouter.delete('/:id', requireAnyPermission(['role:write']), deleteRole)

export default roleRouter
