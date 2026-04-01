import Router from 'koa-router'
import { requireAdminAuth } from '@/middleware/authDomains'
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
  listCategories as listSceneSpotCategories,
  createCategory as createSceneSpotCategory,
  updateCategory as updateSceneSpotCategory,
  removeCategory as removeSceneSpotCategory,
} from '@/controllers/admin/sceneSpotCategoryController'
import {
  listHotSpotsHandler as listHotSpots,
  createHotSpotHandler as createHotSpot,
  updateHotSpotHandler as updateHotSpot,
  deleteHotSpotHandler as deleteHotSpot,
} from '@/controllers/hotSpotController'
import {
  listFeaturedSpotsHandler as listFeaturedSpots,
  createFeaturedSpotHandler as createFeaturedSpot,
  updateFeaturedSpotHandler as updateFeaturedSpot,
  deleteFeaturedSpotHandler as deleteFeaturedSpot,
} from '@/controllers/featuredSpotController'
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from '@/controllers/admin/productController'
import {
  createCategory as createProductCategory,
  listCategories as listProductCategories,
  removeCategory as removeProductCategory,
  updateCategory as updateProductCategory,
} from '@/controllers/admin/productCategoryController'
import {
  createUserVehicle,
  createVehicle,
  deleteUserVehicle,
  deleteVehicle,
  getUserVehicle,
  getVehicle,
  listUserVehicles,
  listVehicles,
  updateUserVehicle,
  updateVehicle,
} from '@/controllers/admin/vehicleController'
import {
  createCoupon,
  deleteCoupon,
  distributeCouponBatch,
  distributeCouponToUser,
  getCouponStats,
  getCoupon,
  listCoupons,
  listUserCoupons,
  useUserCouponByAdmin,
  updateCoupon,
} from '@/controllers/admin/couponController'
import {
  createCouponType,
  deleteCouponType,
  listCouponTypes,
  updateCouponType,
} from '@/controllers/admin/couponTypeController'
import {
  approveOrderRefund,
  createOrder,
  deleteOrder,
  getOrder,
  listOrders,
  rejectOrderRefund,
  updateOrder,
} from '@/controllers/admin/orderController'
import {
  createAppUser,
  deleteAppUser,
  getAppUser,
  listAppUsers,
  updateAppUser,
  updateAppUserStatus,
} from '@/controllers/admin/appUserController'
import {
  createAdminAccount,
  deleteAdminAccount,
  getAdminAccount,
  listAdminAccounts,
  updateAdminAccount,
  updateAdminAccountStatus,
} from '@/controllers/admin/adminAccountController'
import {
  createMiniApp,
  deleteMiniApp,
  getMiniApp,
  listMiniApps,
  updateMiniApp,
} from '@/controllers/admin/miniAppController'
import {
  bulkMoveAssetsCategory,
  createAssetSeries,
  createAssetTag,
  createAssetCategory,
  downloadAsset,
  deleteAsset,
  deleteAssetSeries,
  deleteAssetTag,
  deleteAssetCategory,
  getAsset,
  listAssetSeries,
  listAssetTags,
  listAssets,
  listResourceCategories,
  mergeAssetCategories,
  moveAssetCategory,
  updateAssetSeries,
  updateAssetTag,
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
import { getAnalyticsOverviewData } from '@/controllers/admin/analyticsController'
import { deletePunchRecord, getPunchRecord, listPunchRecords } from '@/controllers/admin/punchRecordController'
import { deleteTravelRecord, getTravelRecord, listTravelRecords } from '@/controllers/admin/travelRecordController'
import {
  createSceneSpotCommentByAdmin,
  deleteSceneSpotComment,
  getSceneSpotComment,
  listSceneSpotComments,
  listSceneSpotCommentsBySceneSpot,
  updateSceneSpotComment,
  updateSceneSpotCommentStatus,
} from '@/controllers/admin/sceneSpotCommentController'
import { koaBody } from '@/utils/bodyParser'
import {
  listAchievements,
  getAchievement,
  createAchievement,
  updateAchievement,
  deleteAchievement,
  listAchievementRules,
  addRulesToAchievement,
  removeRuleFromAchievement,
} from '@/controllers/admin/achievementController'
import { listRules, getRule, createRule, updateRule, deleteRule } from '@/controllers/admin/ruleController'

const adminRouter = new Router({ prefix: '/api/admin' })

adminRouter.use(requireAdminAuth)

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
adminRouter.post(
  '/scene-spots',
  requireAnyPermission(['sceneSpot:write']),
  koaBody({
    multipart: true,
    urlencoded: true,
    formidable: { keepExtensions: true, maxFileSize: 5 * 1024 * 1024, multiples: true },
  }),
  createSceneSpot,
)
adminRouter.put(
  '/scene-spots/:id',
  requireAnyPermission(['sceneSpot:write']),
  koaBody({
    multipart: true,
    urlencoded: true,
    formidable: { keepExtensions: true, maxFileSize: 5 * 1024 * 1024, multiples: true },
  }),
  updateSceneSpot,
)
adminRouter.delete('/scene-spots/:id', requireAnyPermission(['sceneSpot:write']), deleteSceneSpot)
adminRouter.get('/scene-spots/:sceneSpotId/comments', requireAnyPermission(['comment:read']), listSceneSpotCommentsBySceneSpot)

// Scene spot categories
adminRouter.get('/scene-spot-categories', requireAnyPermission(['sceneSpotCategory:read']), listSceneSpotCategories)
adminRouter.post('/scene-spot-categories', requireAnyPermission(['sceneSpotCategory:write']), createSceneSpotCategory)
adminRouter.put('/scene-spot-categories/:id', requireAnyPermission(['sceneSpotCategory:write']), updateSceneSpotCategory)
adminRouter.delete('/scene-spot-categories/:id', requireAnyPermission(['sceneSpotCategory:write']), removeSceneSpotCategory)

// Hot spots (popular)
adminRouter.get('/hot-spots', requireAnyPermission(['sceneSpot:read']), listHotSpots)
adminRouter.post('/hot-spots', requireAnyPermission(['sceneSpot:write']), createHotSpot)
adminRouter.put('/hot-spots/:id', requireAnyPermission(['sceneSpot:write']), updateHotSpot)
adminRouter.delete('/hot-spots/:id', requireAnyPermission(['sceneSpot:write']), deleteHotSpot)

// Featured spots (精选)
adminRouter.get('/featured-spots', requireAnyPermission(['sceneSpot:read']), listFeaturedSpots)
adminRouter.post('/featured-spots', requireAnyPermission(['sceneSpot:write']), createFeaturedSpot)
adminRouter.put('/featured-spots/:id', requireAnyPermission(['sceneSpot:write']), updateFeaturedSpot)
adminRouter.delete('/featured-spots/:id', requireAnyPermission(['sceneSpot:write']), deleteFeaturedSpot)

adminRouter.get('/scene-spot-comments', requireAnyPermission(['comment:read']), listSceneSpotComments)
adminRouter.get('/scene-spot-comments/:id', requireAnyPermission(['comment:read']), getSceneSpotComment)
adminRouter.post('/scene-spot-comments', requireAnyPermission(['comment:write']), createSceneSpotCommentByAdmin)
adminRouter.put('/scene-spot-comments/:id', requireAnyPermission(['comment:write']), updateSceneSpotComment)
adminRouter.patch('/scene-spot-comments/:id/status', requireAnyPermission(['comment:write']), updateSceneSpotCommentStatus)
adminRouter.put('/scene-spot-comments/:id/status', requireAnyPermission(['comment:write']), updateSceneSpotCommentStatus)
adminRouter.delete('/scene-spot-comments/:id', requireAnyPermission(['comment:write']), deleteSceneSpotComment)

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

adminRouter.get('/product-categories', requireAnyPermission(['product:read']), listProductCategories)
adminRouter.post('/product-categories', requireAnyPermission(['product:write']), createProductCategory)
adminRouter.put('/product-categories/:id', requireAnyPermission(['product:write']), updateProductCategory)
adminRouter.delete('/product-categories/:id', requireAnyPermission(['product:write']), removeProductCategory)

adminRouter.get('/vehicles', requireAnyPermission(['vehicle:read']), listVehicles)
adminRouter.get('/vehicles/:id', requireAnyPermission(['vehicle:read']), getVehicle)
adminRouter.post('/vehicles', requireAnyPermission(['vehicle:write']), createVehicle)
adminRouter.put('/vehicles/:id', requireAnyPermission(['vehicle:write']), updateVehicle)
adminRouter.delete('/vehicles/:id', requireAnyPermission(['vehicle:write']), deleteVehicle)

adminRouter.get('/user-vehicles', requireAnyPermission(['vehicle:read']), listUserVehicles)
adminRouter.get('/user-vehicles/:id', requireAnyPermission(['vehicle:read']), getUserVehicle)
adminRouter.post('/user-vehicles', requireAnyPermission(['vehicle:write']), createUserVehicle)
adminRouter.put('/user-vehicles/:id', requireAnyPermission(['vehicle:write']), updateUserVehicle)
adminRouter.delete('/user-vehicles/:id', requireAnyPermission(['vehicle:write']), deleteUserVehicle)

adminRouter.get('/coupons', requireAnyPermission(['coupon:read']), listCoupons)
adminRouter.get('/coupons/stats', requireAnyPermission(['coupon:read']), getCouponStats)
adminRouter.get('/coupons/user-coupons', requireAnyPermission(['coupon:read']), listUserCoupons)
adminRouter.post('/coupons/user-coupons/:id/use', requireAnyPermission(['coupon:write']), useUserCouponByAdmin)
adminRouter.post('/coupons/:id/distribute', requireAnyPermission(['coupon:write']), distributeCouponToUser)
adminRouter.post('/coupons/:id/distribute/batch', requireAnyPermission(['coupon:write']), distributeCouponBatch)
adminRouter.get('/coupons/:id', requireAnyPermission(['coupon:read']), getCoupon)
adminRouter.post('/coupons', requireAnyPermission(['coupon:write']), createCoupon)
adminRouter.put('/coupons/:id', requireAnyPermission(['coupon:write']), updateCoupon)
adminRouter.delete('/coupons/:id', requireAnyPermission(['coupon:write']), deleteCoupon)
adminRouter.get('/coupon-types', requireAnyPermission(['coupon:read']), listCouponTypes)
adminRouter.post('/coupon-types', requireAnyPermission(['coupon:write']), createCouponType)
adminRouter.put('/coupon-types/:id', requireAnyPermission(['coupon:write']), updateCouponType)
adminRouter.delete('/coupon-types/:id', requireAnyPermission(['coupon:write']), deleteCouponType)

adminRouter.get('/orders', requireAnyPermission(['order:read']), listOrders)
adminRouter.get('/orders/:id', requireAnyPermission(['order:read']), getOrder)
adminRouter.post('/orders', requireAnyPermission(['order:write']), createOrder)
adminRouter.put('/orders/:id', requireAnyPermission(['order:write']), updateOrder)
adminRouter.post('/orders/:id/refund/approve', requireAnyPermission(['order:write']), approveOrderRefund)
adminRouter.post('/orders/:id/refund/reject', requireAnyPermission(['order:write']), rejectOrderRefund)
adminRouter.delete('/orders/:id', requireAnyPermission(['order:write']), deleteOrder)

adminRouter.get('/users', requireAnyPermission(['user:read']), listAppUsers)
adminRouter.get('/users/:id', requireAnyPermission(['user:read']), getAppUser)
adminRouter.post('/users', requireAnyPermission(['user:write']), createAppUser)
adminRouter.put('/users/:id', requireAnyPermission(['user:write']), updateAppUser)
adminRouter.patch('/users/:id/status', requireAnyPermission(['user:write']), updateAppUserStatus)
adminRouter.put('/users/:id/status', requireAnyPermission(['user:write']), updateAppUserStatus)
adminRouter.delete('/users/:id', requireAnyPermission(['user:write']), deleteAppUser)

adminRouter.get('/admins', requireAnyPermission(['admin:super']), listAdminAccounts)
adminRouter.get('/admins/:id', requireAnyPermission(['admin:super']), getAdminAccount)
adminRouter.post('/admins', requireAnyPermission(['admin:super']), createAdminAccount)
adminRouter.put('/admins/:id', requireAnyPermission(['admin:super']), updateAdminAccount)
adminRouter.patch('/admins/:id/status', requireAnyPermission(['admin:super']), updateAdminAccountStatus)
adminRouter.put('/admins/:id/status', requireAnyPermission(['admin:super']), updateAdminAccountStatus)
adminRouter.delete('/admins/:id', requireAnyPermission(['admin:super']), deleteAdminAccount)

adminRouter.get('/mini-apps', requireAnyPermission(['admin:super']), listMiniApps)
adminRouter.get('/mini-apps/:id', requireAnyPermission(['admin:super']), getMiniApp)
adminRouter.post('/mini-apps', requireAnyPermission(['admin:super']), createMiniApp)
adminRouter.put('/mini-apps/:id', requireAnyPermission(['admin:super']), updateMiniApp)
adminRouter.delete('/mini-apps/:id', requireAnyPermission(['admin:super']), deleteMiniApp)

adminRouter.get('/resources/assets', requireAnyPermission(['resource:read']), listAssets)
adminRouter.get('/resources/assets/:id', requireAnyPermission(['resource:read']), getAsset)
adminRouter.get('/resources/assets/:id/download', requireAnyPermission(['resource:read']), downloadAsset)
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

adminRouter.get('/resources/tags', requireAnyPermission(['resource:read']), listAssetTags)
adminRouter.post('/resources/tags', requireAnyPermission(['resource:write']), createAssetTag)
adminRouter.put('/resources/tags/:id', requireAnyPermission(['resource:write']), updateAssetTag)
adminRouter.delete('/resources/tags/:id', requireAnyPermission(['resource:write']), deleteAssetTag)

adminRouter.get('/resources/series', requireAnyPermission(['resource:read']), listAssetSeries)
adminRouter.post('/resources/series', requireAnyPermission(['resource:write']), createAssetSeries)
adminRouter.put('/resources/series/:id', requireAnyPermission(['resource:write']), updateAssetSeries)
adminRouter.delete('/resources/series/:id', requireAnyPermission(['resource:write']), deleteAssetSeries)

adminRouter.get('/resources/categories', requireAnyPermission(['category:read']), listResourceCategories)
adminRouter.post('/resources/categories', requireAnyPermission(['category:write']), createAssetCategory)
adminRouter.put('/resources/categories/:id', requireAnyPermission(['category:write']), updateAssetCategory)
adminRouter.delete('/resources/categories/:id', requireAnyPermission(['category:write']), deleteAssetCategory)
adminRouter.post('/resources/categories/:id/move', requireAnyPermission(['category:write']), moveAssetCategory)
adminRouter.post('/resources/categories/merge', requireAnyPermission(['category:write']), mergeAssetCategories)

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
adminRouter.get('/analytics/overview', requireAnyPermission(['auth:read']), getAnalyticsOverviewData)
adminRouter.get('/punch-records', requireAnyPermission(['punch:read']), listPunchRecords)
adminRouter.get('/punch-records/:id', requireAnyPermission(['punch:read']), getPunchRecord)
adminRouter.delete('/punch-records/:id', requireAnyPermission(['punch:delete']), deletePunchRecord)
adminRouter.get('/travel-records', requireAnyPermission(['travel:read']), listTravelRecords)
adminRouter.get('/travel-records/:id', requireAnyPermission(['travel:read']), getTravelRecord)
adminRouter.delete('/travel-records/:id', requireAnyPermission(['travel:delete']), deleteTravelRecord)

// Achievements & Rules
adminRouter.get('/achievements', requireAnyPermission(['achievement:read']), listAchievements)
adminRouter.get('/achievements/:id', requireAnyPermission(['achievement:read']), getAchievement)
adminRouter.post('/achievements', requireAnyPermission(['achievement:write']), koaBody(), createAchievement)
adminRouter.put('/achievements/:id', requireAnyPermission(['achievement:write']), koaBody(), updateAchievement)
adminRouter.delete('/achievements/:id', requireAnyPermission(['achievement:write']), deleteAchievement)

adminRouter.get('/rules', requireAnyPermission(['rule:read']), listRules)
adminRouter.get('/rules/:id', requireAnyPermission(['rule:read']), getRule)
adminRouter.post('/rules', requireAnyPermission(['rule:write']), koaBody(), createRule)
adminRouter.put('/rules/:id', requireAnyPermission(['rule:write']), koaBody(), updateRule)
adminRouter.delete('/rules/:id', requireAnyPermission(['rule:write']), deleteRule)

// Manage rules for an achievement (many-to-many)
adminRouter.get('/achievements/:id/rules', requireAnyPermission(['achievement:read']), listAchievementRules)
adminRouter.post('/achievements/:id/rules', requireAnyPermission(['achievement:write']), koaBody(), addRulesToAchievement)
adminRouter.delete('/achievements/:id/rules/:ruleId', requireAnyPermission(['achievement:write']), removeRuleFromAchievement)

export default adminRouter
