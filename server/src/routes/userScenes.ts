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

userSceneRouter.use(authMiddleware)
userSceneRouter.get('/', listUserSceneDocuments)
userSceneRouter.put(
  '/:id/bundle',
  koaBody({
    multipart: true,
    urlencoded: true,
    formidable: { keepExtensions: true },
  }),
  uploadUserSceneBundle,
)
userSceneRouter.get('/:id/bundle', downloadUserSceneBundle)
userSceneRouter.delete('/', deleteUserSceneDocumentsBulk)
userSceneRouter.delete('/:id', deleteUserSceneDocument)

export default userSceneRouter
