import Router from 'koa-router'
import { getPresetScene, listPresetSceneSummaries } from '@/controllers/presetSceneController'

const presetSceneRouter = new Router({ prefix: '/api/preset-scenes' })

presetSceneRouter.get('/', listPresetSceneSummaries)
presetSceneRouter.get('/:id', getPresetScene)

export default presetSceneRouter
