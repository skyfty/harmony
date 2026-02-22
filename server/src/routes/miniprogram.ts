import Router from 'koa-router'
import { optionalMiniAuth, requireMiniAuth } from '@/middleware/authDomains'
import {
  listSceneSpots,
  getSceneSpot,
  getSceneSpotEntry,
  listSceneProducts,
  toggleSceneSpotFavorite,
  rateSceneSpot,
} from '@/controllers/miniprogram/sceneSpotController'
import { listHotEvents } from '@/controllers/miniprogram/eventController'
import {
  listUserCoupons,
  claimCoupon,
  getUserCouponDetail,
  useUserCoupon,
} from '@/controllers/miniprogram/couponController'
import {
  createWorks,
  listWorks,
  getWork,
  updateWork,
  removeWork,
  toggleWorkLike,
  rateWork,
  shareWork,
} from '@/controllers/miniprogram/workController'
import {
  createCollection,
  listCollections,
  getCollection,
  updateCollection,
  deleteCollection,
  toggleCollectionLike,
  rateCollection,
} from '@/controllers/miniprogram/collectionController'
import {
  listWorkRecords,
  deleteWorkRecord,
  clearWorkRecords,
} from '@/controllers/miniprogram/workRecordController'
import {
  createExhibition,
  listExhibitions,
  getExhibition,
  updateExhibition,
  deleteExhibition,
  withdrawExhibition,
  toggleExhibitionLike,
  rateExhibition,
  visitExhibition,
  shareExhibition,
} from '@/controllers/miniprogram/exhibitionController'
import {
  listProducts,
  getProduct,
  purchaseProduct,
} from '@/controllers/miniprogram/productController'
import {
  listOrders,
  getOrder,
} from '@/controllers/miniprogram/orderController'
import { listAchievements } from '@/controllers/miniprogram/achievementController'
import {
  listAddresses,
  getAddress,
  createAddress,
  updateAddress,
  deleteAddress,
} from '@/controllers/miniprogram/addressController'
import {
  listFeedback,
  createFeedback,
} from '@/controllers/miniprogram/feedbackController'
import { trackAnalyticsEvent } from '@/controllers/miniprogram/analyticsController'
import { createMiniPunchRecord } from '@/controllers/miniprogram/punchRecordController'

// Align with other API prefixes under /api/* so reverse proxy & clients use /api/mini
const miniRouter = new Router({ prefix: '/api/mini' })

// public readable resources
miniRouter.get('/works/:id', optionalMiniAuth, getWork)
miniRouter.get('/collections/:id', optionalMiniAuth, getCollection)
miniRouter.get('/exhibitions/:id', optionalMiniAuth, getExhibition)

// public readable (optional auth enhances with user state)
miniRouter.get('/scene-spots', optionalMiniAuth, listSceneSpots)
miniRouter.get('/scene-spots/:id', optionalMiniAuth, getSceneSpot)
miniRouter.get('/scene-spots/:id/entry', optionalMiniAuth, getSceneSpotEntry)
miniRouter.get('/scenes/:id/products', optionalMiniAuth, listSceneProducts)

miniRouter.get('/events/hot', optionalMiniAuth, listHotEvents)
miniRouter.post('/analytics/events', optionalMiniAuth, trackAnalyticsEvent)

// products can be read anonymously; login adds purchased/state
miniRouter.get('/products', optionalMiniAuth, listProducts)
miniRouter.get('/products/:id', optionalMiniAuth, getProduct)

miniRouter.use(requireMiniAuth)

// scenic interactions
miniRouter.post('/scene-spots/:id/favorite', toggleSceneSpotFavorite)
miniRouter.post('/scene-spots/:id/rate', rateSceneSpot)
miniRouter.post('/punch-records', createMiniPunchRecord)

// works
miniRouter.get('/works', listWorks)
miniRouter.post('/works', createWorks)
miniRouter.patch('/works/:id', updateWork)
miniRouter.delete('/works/:id', removeWork)
miniRouter.post('/works/:id/like', toggleWorkLike)
miniRouter.post('/works/:id/rate', rateWork)
miniRouter.post('/works/:id/share', shareWork)

// collections
miniRouter.get('/collections', listCollections)
miniRouter.post('/collections', createCollection)
miniRouter.patch('/collections/:id', updateCollection)
miniRouter.delete('/collections/:id', deleteCollection)
miniRouter.post('/collections/:id/like', toggleCollectionLike)
miniRouter.post('/collections/:id/rate', rateCollection)

// work records
miniRouter.get('/works/records', listWorkRecords)
miniRouter.delete('/works/records/:id', deleteWorkRecord)
miniRouter.delete('/works/records', clearWorkRecords)

// exhibitions
miniRouter.get('/exhibitions', listExhibitions)
miniRouter.post('/exhibitions', createExhibition)
miniRouter.patch('/exhibitions/:id', updateExhibition)
miniRouter.delete('/exhibitions/:id', deleteExhibition)
miniRouter.post('/exhibitions/:id/withdraw', withdrawExhibition)
miniRouter.post('/exhibitions/:id/like', toggleExhibitionLike)
miniRouter.post('/exhibitions/:id/rate', rateExhibition)
miniRouter.post('/exhibitions/:id/visit', visitExhibition)
miniRouter.post('/exhibitions/:id/share', shareExhibition)

// products
miniRouter.post('/products/:id/purchase', purchaseProduct)

// coupons (user-scoped)
miniRouter.get('/coupons', listUserCoupons)
miniRouter.get('/coupons/:id', getUserCouponDetail)
miniRouter.post('/coupons/:id/use', useUserCoupon)
miniRouter.post('/coupons/:id/claim', claimCoupon)

// orders
miniRouter.get('/orders', listOrders)
miniRouter.get('/orders/:id', getOrder)

// achievements
miniRouter.get('/achievements', listAchievements)

// addresses
miniRouter.get('/addresses', listAddresses)
miniRouter.get('/addresses/:id', getAddress)
miniRouter.post('/addresses', createAddress)
miniRouter.patch('/addresses/:id', updateAddress)
miniRouter.delete('/addresses/:id', deleteAddress)

// feedback
miniRouter.get('/feedback', listFeedback)
miniRouter.post('/feedback', createFeedback)

export default miniRouter
