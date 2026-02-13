import Router from 'koa-router'
import { authMiddleware } from '@/middleware/auth'
import {
  getProject,
  listProjects,
  removeProject,
  saveProject,
} from '@/controllers/userProjectController'

const userProjectRouter = new Router({ prefix: '/api/projects' })

userProjectRouter.use(authMiddleware)
userProjectRouter.get('/', listProjects)
userProjectRouter.get('/:id', getProject)
userProjectRouter.put('/:id', saveProject)
userProjectRouter.delete('/:id', removeProject)

export default userProjectRouter
