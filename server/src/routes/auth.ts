import Router from 'koa-router'
import { login, logout, profile } from '@/controllers/authController'
import { authMiddleware } from '@/middleware/auth'

const authRouter = new Router({ prefix: '/api/auth' })

authRouter.post('/login', login)
authRouter.get('/profile', authMiddleware, profile)
authRouter.post('/logout', authMiddleware, logout)

authRouter.get('/health', (ctx) => {
  ctx.body = { status: 'ok' }
})

export default authRouter
