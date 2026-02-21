import Router from 'koa-router'
import {
  miniLogin,
  miniLogout,
  miniProfile,
  miniRegister,
  miniUpdateProfile,
  miniWechatLogin,
} from '@/controllers/miniAuthController'
import { requireMiniAuth } from '@/middleware/authDomains'

const miniAuthRouter = new Router({ prefix: '/api/mini-auth' })

miniAuthRouter.post('/register', miniRegister)
miniAuthRouter.post('/login', miniLogin)
miniAuthRouter.post('/wechat-login', miniWechatLogin)
miniAuthRouter.get('/profile', requireMiniAuth, miniProfile)
miniAuthRouter.patch('/profile', requireMiniAuth, miniUpdateProfile)
miniAuthRouter.post('/logout', requireMiniAuth, miniLogout)

export default miniAuthRouter
