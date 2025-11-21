import Router from 'koa-router'
import { authMiddleware } from '@/middleware/auth'
import {
  listUserSceneDocuments,
  saveUserSceneDocument,
  deleteUserSceneDocument,
} from '@/controllers/userSceneController'

const userSceneRouter = new Router({ prefix: '/api/user-scenes' })

userSceneRouter.use(authMiddleware)
userSceneRouter.get('/', listUserSceneDocuments)
userSceneRouter.put('/:id', saveUserSceneDocument)
userSceneRouter.delete('/:id', deleteUserSceneDocument)

export default userSceneRouter
