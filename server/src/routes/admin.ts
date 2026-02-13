import Router from 'koa-router'
import { authMiddleware } from '@/middleware/auth'
import { requireAnyPermission } from '@/middleware/permission'
import {
  createScenic,
  deleteScenic,
  getScenic,
  listScenics,
  updateScenic,
} from '@/controllers/admin/scenicController'
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
import { koaBody } from '@/utils/bodyParser'

const adminRouter = new Router({ prefix: '/api/admin' })

adminRouter.use(authMiddleware)

adminRouter.get('/scenics', requireAnyPermission(['scenic:read']), listScenics)
adminRouter.get('/scenics/:id', requireAnyPermission(['scenic:read']), getScenic)
adminRouter.post('/scenics', requireAnyPermission(['scenic:write']), createScenic)
adminRouter.put('/scenics/:id', requireAnyPermission(['scenic:write']), updateScenic)
adminRouter.delete('/scenics/:id', requireAnyPermission(['scenic:write']), deleteScenic)

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

export default adminRouter
