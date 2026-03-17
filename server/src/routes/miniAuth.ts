import Router from 'koa-router'
import {
  miniBindWechatPhone,
  miniLogin,
  miniLogout,
  miniProfile,
  miniRegister,
  miniUploadAvatar,
  miniUpdateProfile,
  miniWechatLogin,
} from '@/controllers/miniAuthController'
import { requireMiniAuth } from '@/middleware/authDomains'
import { koaBody } from '@/utils/bodyParser'

const miniAuthRouter = new Router({ prefix: '/api/mini-auth' })

miniAuthRouter.post('/register', miniRegister)
miniAuthRouter.post('/login', miniLogin)
miniAuthRouter.post('/wechat-login', miniWechatLogin)
miniAuthRouter.post('/bind-phone', requireMiniAuth, miniBindWechatPhone)
miniAuthRouter.post(
  '/avatar',
  requireMiniAuth,
  koaBody({
    multipart: true,
    urlencoded: true,
    formidable: { keepExtensions: true },
  }),
  miniUploadAvatar,
)
miniAuthRouter.get('/profile', requireMiniAuth, miniProfile)
miniAuthRouter.patch('/profile', requireMiniAuth, miniUpdateProfile)
miniAuthRouter.post('/logout', requireMiniAuth, miniLogout)

export default miniAuthRouter
