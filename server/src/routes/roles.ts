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

const roleRouter = new Router({ prefix: '/api/roles' })

roleRouter.use(authMiddleware)
roleRouter.get('/', listRoles)
roleRouter.get('/options/permissions', listPermissionOptions)
roleRouter.get('/:id', getRole)
roleRouter.post('/', createRole)
roleRouter.put('/:id', updateRole)
roleRouter.delete('/:id', deleteRole)

export default roleRouter
