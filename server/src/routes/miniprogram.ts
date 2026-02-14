import Router from 'koa-router'
import { authMiddleware, optionalAuthMiddleware } from '@/middleware/auth'
import { register, login, getProfile, updateProfile } from '@/controllers/miniprogram/userController'
import { listSceneSpots, getSceneSpot, getSceneSpotEntry, listSceneProducts } from '@/controllers/miniprogram/sceneSpotController'
import { listHotEvents } from '@/controllers/miniprogram/eventController'
import { listUserCoupons, claimCoupon } from '@/controllers/miniprogram/couponController'
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

// Align with other API prefixes under /api/* so reverse proxy & clients use /api/mini
const miniRouter = new Router({ prefix: '/api/mini' })

// public auth endpoints
miniRouter.post('/users/register', register)
miniRouter.post('/users/login', login)

// public readable resources
miniRouter.get('/works/:id', optionalAuthMiddleware, getWork)
miniRouter.get('/collections/:id', optionalAuthMiddleware, getCollection)
miniRouter.get('/exhibitions/:id', optionalAuthMiddleware, getExhibition)

// public readable (optional auth enhances with user state)
miniRouter.get('/scene-spots', optionalAuthMiddleware, listSceneSpots)
miniRouter.get('/scene-spots/:id', optionalAuthMiddleware, getSceneSpot)
miniRouter.get('/scene-spots/:id/entry', optionalAuthMiddleware, getSceneSpotEntry)
miniRouter.get('/scenes/:id/products', optionalAuthMiddleware, listSceneProducts)

miniRouter.get('/events/hot', optionalAuthMiddleware, listHotEvents)

// products can be read anonymously; login adds purchased/state
miniRouter.get('/products', optionalAuthMiddleware, listProducts)
miniRouter.get('/products/:id', optionalAuthMiddleware, getProduct)

miniRouter.use(authMiddleware)

// profile
miniRouter.get('/users/me', getProfile)
miniRouter.patch('/users/me', updateProfile)

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
miniRouter.post('/coupons/:id/claim', claimCoupon)

// orders
miniRouter.get('/orders', listOrders)
miniRouter.get('/orders/:id', getOrder)

export default miniRouter
