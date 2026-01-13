import type Router from 'koa-router'
import authRouter from './auth'
import permissionRouter from './permissions'
import resourceRouter from './resources'
import roleRouter from './roles'
import userRouter from './users'
import miniprogramRouter from './miniprogram'
import presetSceneRouter from './presetScenes'
import assistantRouter from './aiAssistant'
import aiTagRouter from './aiTags'
import sceneRouter from './scenes'
import userSceneRouter from './userScenes'
import userProjectRouter from './userProjects'

export const routes: Router[] = [
  authRouter,
  userRouter,
  roleRouter,
  permissionRouter,
  resourceRouter,
  presetSceneRouter,
  sceneRouter,
  miniprogramRouter,
  assistantRouter,
  aiTagRouter,
  userSceneRouter,
  userProjectRouter,
]

export default routes
