import type { Context } from 'koa'
import { createPunchRecord, getPunchProgressBySceneForUser } from '@/services/punchRecordService'
import { evaluatePendingMedalsForUser } from '@/services/medalService'

type CreatePunchRecordBody = {
  sceneId?: string
  scenicId?: string
  vehicleIdentifier?: string
  sceneName?: string
  clientPunchTime?: string
  behaviorPunchTime?: string
  location?: {
    nodeId?: string
    nodeName?: string
  }
  source?: string
  path?: string
  metadata?: Record<string, unknown>
}

export async function createMiniPunchRecord(ctx: Context): Promise<void> {
  const userId = ctx.state.miniAuthUser?.id
  if (!userId) {
    ctx.throw(401, 'Unauthorized')
    return
  }

  const body = (ctx.request.body ?? {}) as CreatePunchRecordBody
  const sceneId = typeof body.sceneId === 'string' ? body.sceneId.trim() : ''
  const scenicId = typeof body.scenicId === 'string' ? body.scenicId.trim() : ''
  const nodeId = typeof body.location?.nodeId === 'string' ? body.location.nodeId.trim() : ''
  if (!sceneId) {
    ctx.throw(400, 'sceneId is required')
    return
  }
  if (!scenicId) {
    ctx.throw(400, 'scenicId is required')
    return
  }
  if (!nodeId) {
    ctx.throw(400, 'location.nodeId is required')
    return
  }

  const id = await createPunchRecord({
    userId,
    username: ctx.state.miniAuthUser?.username,
    sceneId,
    scenicId,
    vehicleIdentifier: typeof body.vehicleIdentifier === 'string' ? body.vehicleIdentifier : undefined,
    sceneName: typeof body.sceneName === 'string' ? body.sceneName : undefined,
    nodeId,
    nodeName: typeof body.location?.nodeName === 'string' ? body.location.nodeName : undefined,
    clientPunchTime: typeof body.clientPunchTime === 'string' ? body.clientPunchTime : undefined,
    behaviorPunchTime: typeof body.behaviorPunchTime === 'string' ? body.behaviorPunchTime : undefined,
    source: typeof body.source === 'string' ? body.source : undefined,
    path: typeof body.path === 'string' ? body.path : undefined,
    ip: ctx.ip,
    userAgent: ctx.get('User-Agent') || undefined,
    metadata: body.metadata,
  })

  try {
    await evaluatePendingMedalsForUser(userId, 'punch_record')
  } catch (error) {
    console.error('Failed to evaluate medals after punch record', error)
  }

  ctx.body = {
    success: true,
    id,
  }
}

export async function getMiniPunchProgress(ctx: Context): Promise<void> {
  const userId = ctx.state.miniAuthUser?.id
  if (!userId) {
    ctx.throw(401, 'Unauthorized')
    return
  }

  const { sceneId, scenicId } = ctx.query as { sceneId?: string; scenicId?: string }
  const normalizedSceneId = typeof sceneId === 'string' ? sceneId.trim() : ''
  const normalizedScenicId = typeof scenicId === 'string' ? scenicId.trim() : ''
  if (!normalizedSceneId) {
    ctx.throw(400, 'sceneId is required')
    return
  }
  if (!normalizedScenicId) {
    ctx.throw(400, 'scenicId is required')
    return
  }

  const progress = await getPunchProgressBySceneForUser({
    userId,
    sceneId: normalizedSceneId,
    scenicId: normalizedScenicId,
  })

  ctx.body = {
    sceneId: progress.sceneId,
    scenicId: progress.scenicId,
    checkedCount: progress.checkedCount,
    punchedNodeIds: progress.punchedNodeIds,
  }
}
