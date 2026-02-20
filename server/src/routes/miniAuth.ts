import Router from 'koa-router'
import {
  miniLogin,
  miniLogout,
  miniProfile,
  miniRegister,
  miniWechatLogin,
} from '@/controllers/miniAuthController'
import { requireMiniAuth } from '@/middleware/authDomains'

const miniAuthRouter = new Router({ prefix: '/api/mini-auth' })

miniAuthRouter.post('/register', miniRegister)
miniAuthRouter.post('/login', miniLogin)
miniAuthRouter.post('/wechat-login', miniWechatLogin)
miniAuthRouter.get('/profile', requireMiniAuth, miniProfile)
miniAuthRouter.post('/logout', requireMiniAuth, miniLogout)

export default miniAuthRouter
