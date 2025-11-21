import Router from 'koa-router'
import { authMiddleware } from '@/middleware/auth'
import {
  createSceneEntry,
  deleteSceneEntry,
  downloadSceneFile,
  getScene,
  listSceneSummaries,
  updateSceneEntry,
} from '@/controllers/sceneController'
import { koaBody } from '@/utils/bodyParser'

const sceneRouter = new Router({ prefix: '/api/scenes' })

sceneRouter.use(authMiddleware)

sceneRouter.get('/', listSceneSummaries)
sceneRouter.get('/:id', getScene)
sceneRouter.post(
  '/',
  koaBody({
    multipart: true,
    urlencoded: true,
    formidable: { keepExtensions: true },
  }),
  createSceneEntry,
)
sceneRouter.put(
  '/:id',
  koaBody({
    multipart: true,
    urlencoded: true,
    formidable: { keepExtensions: true },
  }),
  updateSceneEntry,
)
sceneRouter.patch(
  '/:id',
  koaBody({
    multipart: true,
    urlencoded: true,
    formidable: { keepExtensions: true },
  }),
  updateSceneEntry,
)
sceneRouter.delete('/:id', deleteSceneEntry)
sceneRouter.get('/:id/download', downloadSceneFile)

export default sceneRouter
