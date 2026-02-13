import Router from 'koa-router'
import { authMiddleware } from '@/middleware/auth'
import {
  bulkMoveAssetsCategory,
  createAssetSeries,
  createAssetCategory,
  createAssetTag,
  deleteAsset,
  deleteAssetCategory,
  deleteAssetTag,
  downloadAsset,
  getAsset,
  getAssetCategoryChildren,
  deleteAssetSeries,
  getAssetCategoryDescendants,
  getAssetCategoryPath,
  getAssetManifest,
  getProjectDirectories,
  listCategoryAssets,
  listAssetTags,
  listAssets,
  listAssetSeries,
  listSeriesAssets,
  listResourceCategories,
  mergeAssetCategories,
  moveAssetCategory,
  searchAssetCategories,
  refreshAssetManifest,
  updateAsset,
  updateAssetCategory,
  updateAssetTag,
  uploadAsset,
} from '@/controllers/resourceController'
import { koaBody } from '@/utils/bodyParser'

const resourceRouter = new Router({ prefix: '/api/resources' })

resourceRouter.get('/assets/manifest', getAssetManifest)
resourceRouter.get('/categories', listResourceCategories)
resourceRouter.get('/categories/search', searchAssetCategories)

resourceRouter.use(authMiddleware)
resourceRouter.post('/categories', createAssetCategory)
resourceRouter.get('/categories/:id/children', getAssetCategoryChildren)
resourceRouter.get('/categories/:id/path', getAssetCategoryPath)
resourceRouter.get('/categories/:id/descendants', getAssetCategoryDescendants)
resourceRouter.get('/categories/:id/assets', listCategoryAssets)
resourceRouter.put('/categories/:id', updateAssetCategory)
resourceRouter.delete('/categories/:id', deleteAssetCategory)
resourceRouter.post('/categories/:id/move', moveAssetCategory)
resourceRouter.post('/categories/merge', mergeAssetCategories)
resourceRouter.get('/series', listAssetSeries)
resourceRouter.post('/series', createAssetSeries)
resourceRouter.get('/series/:id/assets', listSeriesAssets)
resourceRouter.delete('/series/:id', deleteAssetSeries)
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
resourceRouter.post('/assets/bulk-move-category', bulkMoveAssetsCategory)
resourceRouter.post('/assets/manifest/refresh', refreshAssetManifest)
resourceRouter.get('/tags', listAssetTags)
resourceRouter.post('/tags', createAssetTag)
resourceRouter.put('/tags/:id', updateAssetTag)
resourceRouter.delete('/tags/:id', deleteAssetTag)

export default resourceRouter
