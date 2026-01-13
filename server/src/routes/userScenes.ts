import Router from 'koa-router'
import { authMiddleware } from '@/middleware/auth'
import {
  listUserSceneDocuments,
  getUserSceneDocument,
  saveUserSceneDocument,
  deleteUserSceneDocument,
  deleteUserSceneDocumentsBulk,
} from '@/controllers/userSceneController'

const userSceneRouter = new Router({ prefix: '/api/user-scenes' })

userSceneRouter.use(authMiddleware)
userSceneRouter.get('/', listUserSceneDocuments)
userSceneRouter.get('/:id', getUserSceneDocument)
userSceneRouter.put('/:id', saveUserSceneDocument)
userSceneRouter.delete('/', deleteUserSceneDocumentsBulk)
userSceneRouter.delete('/:id', deleteUserSceneDocument)

export default userSceneRouter
