import type Router from 'koa-router'
import authRouter from './auth'
import contentRouter from './contents'
import menuRouter from './menus'
import permissionRouter from './permissions'
import resourceRouter from './resources'
import roleRouter from './roles'
import userRouter from './users'

export const routes: Router[] = [
  authRouter,
  userRouter,
  roleRouter,
  permissionRouter,
  menuRouter,
  contentRouter,
  resourceRouter,
]

export default routes
