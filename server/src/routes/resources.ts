import Router from 'koa-router'
import { authMiddleware } from '@/middleware/auth'
import {
  createAssetTag,
  deleteAsset,
  deleteAssetTag,
  downloadAsset,
  getAsset,
  getAssetManifest,
  getProjectDirectories,
  listAssetTags,
  listAssets,
  listResourceCategories,
  refreshAssetManifest,
  updateAsset,
  updateAssetTag,
  uploadAsset,
} from '@/controllers/resourceController'
import { koaBody } from '@/utils/bodyParser'

const resourceRouter = new Router({ prefix: '/api/resources' })

resourceRouter.get('/assets/manifest', getAssetManifest)

resourceRouter.use(authMiddleware)
resourceRouter.get('/categories', listResourceCategories)
resourceRouter.get('/directories', getProjectDirectories)
resourceRouter.get('/assets', listAssets)
resourceRouter.get('/assets/:id', getAsset)
resourceRouter.post(
  '/assets',
  koaBody({
    multipart: true,
    urlencoded: true,
    formidable: { keepExtensions: true },
  }),
  uploadAsset,
)
resourceRouter.put(
  '/assets/:id',
  koaBody({
    multipart: true,
    urlencoded: true,
    formidable: { keepExtensions: true },
  }),
  updateAsset,
)
resourceRouter.delete('/assets/:id', deleteAsset)
resourceRouter.get('/assets/:id/download', downloadAsset)
resourceRouter.post('/assets/manifest/refresh', refreshAssetManifest)
resourceRouter.get('/tags', listAssetTags)
resourceRouter.post('/tags', createAssetTag)
resourceRouter.put('/tags/:id', updateAssetTag)
resourceRouter.delete('/tags/:id', deleteAssetTag)

export default resourceRouter
