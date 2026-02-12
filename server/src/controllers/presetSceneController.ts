import type { Context } from 'koa'
import { getPresetSceneDetail, listPresetScenes } from '@/services/presetSceneService'

export async function listPresetSceneSummaries(ctx: Context): Promise<void> {
  const data = listPresetScenes()
  ctx.body = data
}

export async function getPresetScene(ctx: Context): Promise<void> {
  const sceneId = ctx.params?.id
  if (!sceneId) {
    ctx.status = 400
    ctx.body = { message: '缺少预置场景 ID' }
    return
  }

  const detail = getPresetSceneDetail(sceneId)
  if (!detail) {
    ctx.status = 404
    ctx.body = { message: '预置场景不存在' }
    return
  }

  ctx.body = detail
}
