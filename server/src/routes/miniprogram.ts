import Router from 'koa-router'
import { authMiddleware } from '@/middleware/auth'
import { register, login, getProfile, updateProfile } from '@/controllers/miniprogram/userController'
import {
  createWorks,
  listWorks,
  getWork,
  removeWork,
  toggleWorkLike,
  rateWork,
} from '@/controllers/miniprogram/workController'
import {
  createCollection,
  listCollections,
  getCollection,
  updateCollection,
  deleteCollection,
} from '@/controllers/miniprogram/collectionController'
import {
  listUploadRecords,
  deleteUploadRecord,
  clearUploadRecords,
} from '@/controllers/miniprogram/uploadController'
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

const miniRouter = new Router({ prefix: '/mini' })

// public auth endpoints
miniRouter.post('/users/register', register)
miniRouter.post('/users/login', login)

miniRouter.use(authMiddleware)

// profile
miniRouter.get('/users/me', getProfile)
miniRouter.patch('/users/me', updateProfile)

// works
miniRouter.get('/works', listWorks)
miniRouter.post('/works', createWorks)
miniRouter.get('/works/:id', getWork)
miniRouter.delete('/works/:id', removeWork)
miniRouter.post('/works/:id/like', toggleWorkLike)
miniRouter.post('/works/:id/rate', rateWork)

// collections
miniRouter.get('/collections', listCollections)
miniRouter.post('/collections', createCollection)
miniRouter.get('/collections/:id', getCollection)
miniRouter.patch('/collections/:id', updateCollection)
miniRouter.delete('/collections/:id', deleteCollection)

// upload records
miniRouter.get('/uploads/records', listUploadRecords)
miniRouter.delete('/uploads/records/:id', deleteUploadRecord)
miniRouter.delete('/uploads/records', clearUploadRecords)

// exhibitions
miniRouter.get('/exhibitions', listExhibitions)
miniRouter.post('/exhibitions', createExhibition)
miniRouter.get('/exhibitions/:id', getExhibition)
miniRouter.patch('/exhibitions/:id', updateExhibition)
miniRouter.delete('/exhibitions/:id', deleteExhibition)
miniRouter.post('/exhibitions/:id/withdraw', withdrawExhibition)
miniRouter.post('/exhibitions/:id/like', toggleExhibitionLike)
miniRouter.post('/exhibitions/:id/rate', rateExhibition)
miniRouter.post('/exhibitions/:id/visit', visitExhibition)
miniRouter.post('/exhibitions/:id/share', shareExhibition)

// products
miniRouter.get('/products', listProducts)
miniRouter.get('/products/:id', getProduct)
miniRouter.post('/products/:id/purchase', purchaseProduct)

// orders
miniRouter.get('/orders', listOrders)
miniRouter.get('/orders/:id', getOrder)

export default miniRouter
