import Router from 'koa-router'
import { authMiddleware } from '@/middleware/auth'
import {
  createFetchPlan,
  listProviders,
  proxyTile,
} from '@/controllers/terrainImageryController'

const terrainImageryRouter = new Router({ prefix: '/api/terrain-imagery' })

terrainImageryRouter.use(authMiddleware)
terrainImageryRouter.get('/providers', listProviders)
terrainImageryRouter.post('/fetch-plan', createFetchPlan)
terrainImageryRouter.get('/providers/:providerId/tiles/:z/:x/:y', proxyTile)

export default terrainImageryRouter
