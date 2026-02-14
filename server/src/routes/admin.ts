import Router from 'koa-router'
import { authMiddleware } from '@/middleware/auth'
import { requireAnyPermission } from '@/middleware/permission'
import {
  createScene,
  deleteScene,
  getScene,
  listScenes,
  updateScene,
} from '@/controllers/sceneController'
import {
  listSceneSpots,
  getSceneSpot,
  createSceneSpot,
  updateSceneSpot,
  deleteSceneSpot,
} from '@/controllers/sceneSpotController'
import {
  listBindings,
  createBinding,
  updateBinding,
  deleteBinding,
} from '@/controllers/admin/sceneBindingController'
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from '@/controllers/admin/productController'
import {
  createCoupon,
  deleteCoupon,
  getCoupon,
  listCoupons,
  updateCoupon,
} from '@/controllers/admin/couponController'
import {
  createOrder,
  deleteOrder,
  getOrder,
  listOrders,
  updateOrder,
} from '@/controllers/admin/orderController'
import {
  createUser,
  deleteUser,
  getUser,
  listUsers,
  updateUser,
  updateUserStatus,
} from '@/controllers/userController'
import {
  bulkMoveAssetsCategory,
  createAssetCategory,
  deleteAsset,
  deleteAssetCategory,
  getAsset,
  listAssets,
  listResourceCategories,
  mergeAssetCategories,
  moveAssetCategory,
  updateAsset,
  updateAssetCategory,
  uploadAsset,
} from '@/controllers/resourceController'
import {
  createProject,
  createProjectCategory,
  getProject,
  listProjectCategories,
  listProjects,
  removeProject,
  removeProjectCategory,
  removeProjectScene,
  updateProject,
  updateProjectCategory,
  uploadProjectSceneBundle,
} from '@/controllers/admin/userProjectController'
import {
  listLoginLogs,
  getLoginLog,
  deleteLoginLog,
  bulkDeleteLoginLogs,
  exportLoginLogs,
} from '@/controllers/admin/loginAuditController'
import { koaBody } from '@/utils/bodyParser'

const adminRouter = new Router({ prefix: '/api/admin' })

adminRouter.use(authMiddleware)

adminRouter.get('/scenes', requireAnyPermission(['scene:read']), listScenes)
adminRouter.get('/scenes/:id', requireAnyPermission(['scene:read']), getScene)
adminRouter.post(
  '/scenes',
  requireAnyPermission(['scene:write']),
  koaBody({ multipart: true, urlencoded: true, formidable: { keepExtensions: true } }),
  createScene,
)
adminRouter.put(
  '/scenes/:id',
  requireAnyPermission(['scene:write']),
  koaBody({ multipart: true, urlencoded: true, formidable: { keepExtensions: true } }),
  updateScene,
)
adminRouter.delete('/scenes/:id', requireAnyPermission(['scene:write']), deleteScene)

// Scene spots (POIs)
adminRouter.get('/scene-spots', requireAnyPermission(['sceneSpot:read']), listSceneSpots)
adminRouter.get('/scene-spots/:id', requireAnyPermission(['sceneSpot:read']), getSceneSpot)
adminRouter.post('/scene-spots', requireAnyPermission(['sceneSpot:write']), createSceneSpot)
adminRouter.put('/scene-spots/:id', requireAnyPermission(['sceneSpot:write']), updateSceneSpot)
adminRouter.delete('/scene-spots/:id', requireAnyPermission(['sceneSpot:write']), deleteSceneSpot)

// Scene - Product bindings
adminRouter.get('/scenes/:scenicId/bindings', requireAnyPermission(['scene:read']), listBindings)
adminRouter.post('/scenes/:scenicId/bindings', requireAnyPermission(['scene:write']), createBinding)
adminRouter.put('/scenes/:scenicId/bindings/:id', requireAnyPermission(['scene:write']), updateBinding)
adminRouter.delete('/scenes/:scenicId/bindings/:id', requireAnyPermission(['scene:write']), deleteBinding)

adminRouter.get('/products', requireAnyPermission(['product:read']), listProducts)
adminRouter.get('/products/:id', requireAnyPermission(['product:read']), getProduct)
adminRouter.post('/products', requireAnyPermission(['product:write']), createProduct)
adminRouter.put('/products/:id', requireAnyPermission(['product:write']), updateProduct)
adminRouter.delete('/products/:id', requireAnyPermission(['product:write']), deleteProduct)

adminRouter.get('/coupons', requireAnyPermission(['coupon:read']), listCoupons)
adminRouter.get('/coupons/:id', requireAnyPermission(['coupon:read']), getCoupon)
adminRouter.post('/coupons', requireAnyPermission(['coupon:write']), createCoupon)
adminRouter.put('/coupons/:id', requireAnyPermission(['coupon:write']), updateCoupon)
adminRouter.delete('/coupons/:id', requireAnyPermission(['coupon:write']), deleteCoupon)

adminRouter.get('/orders', requireAnyPermission(['order:read']), listOrders)
adminRouter.get('/orders/:id', requireAnyPermission(['order:read']), getOrder)
adminRouter.post('/orders', requireAnyPermission(['order:write']), createOrder)
adminRouter.put('/orders/:id', requireAnyPermission(['order:write']), updateOrder)
adminRouter.delete('/orders/:id', requireAnyPermission(['order:write']), deleteOrder)

adminRouter.get('/users', requireAnyPermission(['user:read']), listUsers)
adminRouter.get('/users/:id', requireAnyPermission(['user:read']), getUser)
adminRouter.post('/users', requireAnyPermission(['user:write']), createUser)
adminRouter.put('/users/:id', requireAnyPermission(['user:write']), updateUser)
adminRouter.patch('/users/:id/status', requireAnyPermission(['user:write']), updateUserStatus)
adminRouter.put('/users/:id/status', requireAnyPermission(['user:write']), updateUserStatus)
adminRouter.delete('/users/:id', requireAnyPermission(['user:write']), deleteUser)

adminRouter.get('/resources/assets', requireAnyPermission(['resource:read']), listAssets)
adminRouter.get('/resources/assets/:id', requireAnyPermission(['resource:read']), getAsset)
adminRouter.post(
  '/resources/assets',
  requireAnyPermission(['resource:write']),
  koaBody({ multipart: true, urlencoded: true, formidable: { keepExtensions: true } }),
  uploadAsset,
)
adminRouter.put(
  '/resources/assets/:id',
  requireAnyPermission(['resource:write']),
  koaBody({ multipart: true, urlencoded: true, formidable: { keepExtensions: true } }),
  updateAsset,
)
adminRouter.delete('/resources/assets/:id', requireAnyPermission(['resource:write']), deleteAsset)
adminRouter.post('/resources/assets/bulk-move-category', requireAnyPermission(['resource:write']), bulkMoveAssetsCategory)

adminRouter.get('/categories', requireAnyPermission(['category:read']), listResourceCategories)
adminRouter.post('/categories', requireAnyPermission(['category:write']), createAssetCategory)
adminRouter.put('/categories/:id', requireAnyPermission(['category:write']), updateAssetCategory)
adminRouter.delete('/categories/:id', requireAnyPermission(['category:write']), deleteAssetCategory)
adminRouter.post('/categories/:id/move', requireAnyPermission(['category:write']), moveAssetCategory)
adminRouter.post('/categories/merge', requireAnyPermission(['category:write']), mergeAssetCategories)

adminRouter.get('/projects', requireAnyPermission(['project:read']), listProjects)
adminRouter.post('/projects', requireAnyPermission(['project:write']), createProject)
adminRouter.get('/projects/:userId/:projectId', requireAnyPermission(['project:read']), getProject)
adminRouter.put('/projects/:userId/:projectId', requireAnyPermission(['project:write']), updateProject)
adminRouter.delete('/projects/:userId/:projectId', requireAnyPermission(['project:write']), removeProject)
adminRouter.put(
  '/projects/:userId/:projectId/scenes/:sceneId/bundle',
  requireAnyPermission(['project:write']),
  koaBody({ multipart: true, urlencoded: true, formidable: { keepExtensions: true } }),
  uploadProjectSceneBundle,
)
adminRouter.delete(
  '/projects/:userId/:projectId/scenes/:sceneId',
  requireAnyPermission(['project:write']),
  removeProjectScene,
)

adminRouter.get('/project-categories', requireAnyPermission(['projectCategory:read']), listProjectCategories)
adminRouter.post('/project-categories', requireAnyPermission(['projectCategory:write']), createProjectCategory)
adminRouter.put('/project-categories/:id', requireAnyPermission(['projectCategory:write']), updateProjectCategory)
adminRouter.delete('/project-categories/:id', requireAnyPermission(['projectCategory:write']), removeProjectCategory)

// Login audit / login logs
adminRouter.get('/login-logs', requireAnyPermission(['auth:read']), listLoginLogs)
adminRouter.get('/login-logs/:id', requireAnyPermission(['auth:read']), getLoginLog)
adminRouter.delete('/login-logs/:id', requireAnyPermission(['auth:delete']), deleteLoginLog)
adminRouter.delete('/login-logs', requireAnyPermission(['auth:delete']), bulkDeleteLoginLogs)
adminRouter.get('/login-logs/export', requireAnyPermission(['auth:export']), exportLoginLogs)

export default adminRouter
