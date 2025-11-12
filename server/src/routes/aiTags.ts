import Router from 'koa-router'
import { authMiddleware } from '@/middleware/auth'
import { handleGenerateTags } from '@/controllers/aiTagController'

const aiTagRouter = new Router({ prefix: '/api/ai' })

aiTagRouter.use(authMiddleware)
aiTagRouter.post('/tags/suggest', handleGenerateTags)

export default aiTagRouter
