import Router from 'koa-router'
import { authMiddleware } from '@/middleware/auth'
import {
  listUserSceneDocuments,
  uploadUserSceneBundle,
  downloadUserSceneBundle,
  deleteUserSceneDocument,
  deleteUserSceneDocumentsBulk,
} from '@/controllers/userSceneController'
import { koaBody } from '@/utils/bodyParser'

const userSceneRouter = new Router({ prefix: '/api/user-scenes' })

userSceneRouter.get('/:id/bundle', downloadUserSceneBundle)
userSceneRouter.get('/', authMiddleware, listUserSceneDocuments)
userSceneRouter.put(
  '/:id/bundle',
  authMiddleware,
  koaBody({
    multipart: true,
    urlencoded: true,
    formidable: { keepExtensions: true },
  }),
  uploadUserSceneBundle,
)
userSceneRouter.delete('/', authMiddleware, deleteUserSceneDocumentsBulk)
userSceneRouter.delete('/:id', authMiddleware, deleteUserSceneDocument)

export default userSceneRouter
