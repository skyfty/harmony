import Router from 'koa-router'
import { authMiddleware } from '@/middleware/auth'
import { requireAnyPermission } from '@/middleware/permission'
import {
  bulkMoveAssetsDirectory,
  bulkMoveAssetsCategory,
  createAssetDirectory,
  createAssetSeries,
  updateAssetSeries,
  createAssetCategory,
  createAssetTag,
  deleteAsset,
  deleteAssetCategory,
  deleteAssetDirectory,
  deleteAssetTag,
  downloadAsset,
  getAsset,
  getAssetCategoryChildren,
  deleteAssetSeries,
  getAssetCategoryDescendants,
  getAssetCategoryPath,
  getAssetManifest,
  getProjectDirectories,
  listAssetDirectories,
  listAssetDirectoryEntries,
  listCategoryAssets,
  listAssetTags,
  listAssets,
  listAssetSeries,
  listSeriesAssets,
  listResourceCategories,
  mergeAssetCategories,
  moveAssetCategory,
  moveAssetDirectory,
  searchAssetCategories,
  refreshAssetManifest,
  updateAsset,
  updateAssetCategory,
  updateAssetDirectory,
  updateAssetTag,
  uploadAsset,
} from '@/controllers/resourceController'
import { koaBody } from '@/utils/bodyParser'

const resourceRouter = new Router({ prefix: '/api/resources' })

resourceRouter.get('/assets/manifest', getAssetManifest)
resourceRouter.get('/categories', listResourceCategories)
resourceRouter.get('/categories/search', searchAssetCategories)

resourceRouter.use(authMiddleware)
resourceRouter.post('/categories', requireAnyPermission(['resource:write']), createAssetCategory)
resourceRouter.get('/asset-directories', requireAnyPermission(['resource:read']), listAssetDirectories)
resourceRouter.get('/asset-directories/entries', requireAnyPermission(['resource:read']), listAssetDirectoryEntries)
resourceRouter.post('/asset-directories', requireAnyPermission(['resource:write']), createAssetDirectory)
resourceRouter.put('/asset-directories/:id', requireAnyPermission(['resource:write']), updateAssetDirectory)
resourceRouter.delete('/asset-directories/:id', requireAnyPermission(['resource:write']), deleteAssetDirectory)
resourceRouter.post('/asset-directories/:id/move', requireAnyPermission(['resource:write']), moveAssetDirectory)
resourceRouter.get('/categories/:id/children', requireAnyPermission(['resource:read']), getAssetCategoryChildren)
resourceRouter.get('/categories/:id/path', requireAnyPermission(['resource:read']), getAssetCategoryPath)
resourceRouter.get('/categories/:id/descendants', requireAnyPermission(['resource:read']), getAssetCategoryDescendants)
resourceRouter.get('/categories/:id/assets', requireAnyPermission(['resource:read']), listCategoryAssets)
resourceRouter.put('/categories/:id', requireAnyPermission(['resource:write']), updateAssetCategory)
resourceRouter.delete('/categories/:id', requireAnyPermission(['resource:write']), deleteAssetCategory)
resourceRouter.post('/categories/:id/move', requireAnyPermission(['resource:write']), moveAssetCategory)
resourceRouter.post('/categories/merge', requireAnyPermission(['resource:write']), mergeAssetCategories)
resourceRouter.get('/series', requireAnyPermission(['resource:read']), listAssetSeries)
resourceRouter.post('/series', requireAnyPermission(['resource:write']), createAssetSeries)
resourceRouter.put('/series/:id', requireAnyPermission(['resource:write']), updateAssetSeries)
resourceRouter.get('/series/:id/assets', requireAnyPermission(['resource:read']), listSeriesAssets)
resourceRouter.delete('/series/:id', requireAnyPermission(['resource:write']), deleteAssetSeries)
resourceRouter.get('/directories', requireAnyPermission(['resource:read']), getProjectDirectories)
resourceRouter.get('/assets', requireAnyPermission(['resource:read']), listAssets)
resourceRouter.get('/assets/:id', requireAnyPermission(['resource:read']), getAsset)
resourceRouter.post(
  '/assets',
  requireAnyPermission(['resource:write']),
  koaBody({
    multipart: true,
    urlencoded: true,
    formidable: { keepExtensions: true },
  }),
  uploadAsset,
)
resourceRouter.put(
  '/assets/:id',
  requireAnyPermission(['resource:write']),
  koaBody({
    multipart: true,
    urlencoded: true,
    formidable: { keepExtensions: true },
  }),
  updateAsset,
)
resourceRouter.delete('/assets/:id', requireAnyPermission(['resource:write']), deleteAsset)
resourceRouter.get('/assets/:id/download', requireAnyPermission(['resource:read']), downloadAsset)
resourceRouter.post('/assets/bulk-move-category', requireAnyPermission(['resource:write']), bulkMoveAssetsCategory)
resourceRouter.post('/assets/bulk-move-directory', requireAnyPermission(['resource:write']), bulkMoveAssetsDirectory)
resourceRouter.post('/assets/manifest/refresh', requireAnyPermission(['resource:write']), refreshAssetManifest)
resourceRouter.get('/tags', requireAnyPermission(['resource:read']), listAssetTags)
resourceRouter.post('/tags', requireAnyPermission(['resource:write']), createAssetTag)
resourceRouter.put('/tags/:id', requireAnyPermission(['resource:write']), updateAssetTag)
resourceRouter.delete('/tags/:id', requireAnyPermission(['resource:write']), deleteAssetTag)

export default resourceRouter
