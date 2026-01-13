import Router from 'koa-router'
import { authMiddleware } from '@/middleware/auth'
import {
  deleteUserProjectDocument,
  getUserProjectDocument,
  listUserProjectDocuments,
  saveUserProjectDocument,
} from '@/controllers/userProjectController'

const userProjectRouter = new Router({ prefix: '/api/user-projects' })

userProjectRouter.use(authMiddleware)
userProjectRouter.get('/', listUserProjectDocuments)
userProjectRouter.get('/:id', getUserProjectDocument)
userProjectRouter.put('/:id', saveUserProjectDocument)
userProjectRouter.delete('/:id', deleteUserProjectDocument)

export default userProjectRouter
