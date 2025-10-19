import Router from 'koa-router'
import { authMiddleware } from '@/middleware/auth'
import {
  deleteAsset,
  getProjectDirectories,
  listAssets,
  listResourceCategories,
  uploadAsset,
} from '@/controllers/resourceController'
import { koaBody } from '@/utils/bodyParser'

const resourceRouter = new Router({ prefix: '/api/resources' })

resourceRouter.use(authMiddleware)
resourceRouter.get('/categories', listResourceCategories)
resourceRouter.get('/directories', getProjectDirectories)
resourceRouter.get('/assets', listAssets)
resourceRouter.post(
  '/assets',
  koaBody({
    multipart: true,
    urlencoded: true,
    formidable: { keepExtensions: true },
  }),
  uploadAsset,
)
resourceRouter.delete('/assets/:id', deleteAsset)

export default resourceRouter
