import type Router from 'koa-router'
import permissionRouter from './permissions'
import resourceRouter from './resources'
import roleRouter from './roles'
import miniprogramRouter from './miniprogram'
import hotFeaturedRouter from './hotFeatured'
import assistantRouter from './aiAssistant'
import aiTagRouter from './aiTags'
import userSceneRouter from './userScenes'
import userProjectRouter from './userProjects'
import adminRouter from './admin'
import adminAuthRouter from './adminAuth'
import miniAuthRouter from './miniAuth'
import authRouter from './auth'
import menuRouter from './menu'
import wechatPayRouter from './wechatPay'

export const routes: Router[] = [
  roleRouter,
  permissionRouter,
  resourceRouter,
  hotFeaturedRouter,
  miniprogramRouter,
  assistantRouter,
  aiTagRouter,
  userSceneRouter,
  userProjectRouter,
  adminRouter,
  adminAuthRouter,
  miniAuthRouter,
  authRouter,
  menuRouter,
  wechatPayRouter,
]

export default routes
