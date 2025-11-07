import type Router from 'koa-router'
import authRouter from './auth'
import permissionRouter from './permissions'
import resourceRouter from './resources'
import roleRouter from './roles'
import userRouter from './users'
import miniprogramRouter from './miniprogram'

export const routes: Router[] = [
  authRouter,
  userRouter,
  roleRouter,
  permissionRouter,
  resourceRouter,
  miniprogramRouter,
]

export default routes
