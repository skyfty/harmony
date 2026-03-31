import Router from 'koa-router'
import { listHotSpotsPublic, listFeaturedSpotsPublic } from '@/controllers/miniprogram/hotFeaturedController'

// Public API (no admin prefix) for hot/featured spots so other modules can call directly
const publicRouter = new Router({ prefix: '/api' })

publicRouter.get('/hot-spots', listHotSpotsPublic)
publicRouter.get('/featured-spots', listFeaturedSpotsPublic)

export default publicRouter
