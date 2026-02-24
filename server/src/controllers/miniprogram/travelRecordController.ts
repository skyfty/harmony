import type { Context } from 'koa'
import {
  completeTravelLeaveRecord,
  createTravelEnterRecord,
  queryTravelRecords,
} from '@/services/travelRecordService'

type EnterTravelBody = {
  sceneId?: string
  scenicId?: string
  sceneName?: string
  enterTime?: string
  source?: string
  path?: string
  metadata?: Record<string, unknown>
}

type LeaveTravelBody = {
  sceneId?: string
  scenicId?: string
  leaveTime?: string
  source?: string
  path?: string
  metadata?: Record<string, unknown>
}

export async function createMiniTravelEnterRecord(ctx: Context): Promise<void> {
  const userId = ctx.state.miniAuthUser?.id
  if (!userId) {
    ctx.throw(401, 'Unauthorized')
    return
  }

  const body = (ctx.request.body ?? {}) as EnterTravelBody
  const sceneId = typeof body.sceneId === 'string' ? body.sceneId.trim() : ''
  const scenicId = typeof body.scenicId === 'string' ? body.scenicId.trim() : ''
  if (!sceneId) {
    ctx.throw(400, 'sceneId is required')
    return
  }
  if (!scenicId) {
    ctx.throw(400, 'scenicId is required')
    return
  }

  const id = await createTravelEnterRecord({
    userId,
    username: ctx.state.miniAuthUser?.username,
    sceneId,
    scenicId,
    sceneName: typeof body.sceneName === 'string' ? body.sceneName : undefined,
    enterTime: typeof body.enterTime === 'string' ? body.enterTime : undefined,
    source: typeof body.source === 'string' ? body.source : undefined,
    path: typeof body.path === 'string' ? body.path : undefined,
    ip: ctx.ip,
    userAgent: ctx.get('User-Agent') || undefined,
    metadata: body.metadata,
  })

  ctx.body = {
    success: true,
    id,
  }
}

export async function completeMiniTravelLeaveRecord(ctx: Context): Promise<void> {
  const userId = ctx.state.miniAuthUser?.id
  if (!userId) {
    ctx.throw(401, 'Unauthorized')
    return
  }

  const body = (ctx.request.body ?? {}) as LeaveTravelBody
  const scenicId = typeof body.scenicId === 'string' ? body.scenicId.trim() : ''
  if (!scenicId) {
    ctx.throw(400, 'scenicId is required')
    return
  }

  const id = await completeTravelLeaveRecord({
    userId,
    sceneId: typeof body.sceneId === 'string' ? body.sceneId : undefined,
    scenicId,
    leaveTime: typeof body.leaveTime === 'string' ? body.leaveTime : undefined,
    source: typeof body.source === 'string' ? body.source : undefined,
    path: typeof body.path === 'string' ? body.path : undefined,
    metadata: body.metadata,
  })

  ctx.body = {
    success: true,
    id,
  }
}

export async function listMiniTravelRecords(ctx: Context): Promise<void> {
  const userId = ctx.state.miniAuthUser?.id
  if (!userId) {
    ctx.throw(401, 'Unauthorized')
    return
  }

  const { page = '1', pageSize = '20', sceneId, sceneName, status, start, end } = ctx.query as Record<string, string>

  const result = await queryTravelRecords({
    page: Number(page),
    pageSize: Number(pageSize),
    sceneId,
    sceneName,
    status: status === 'active' || status === 'completed' ? status : undefined,
    start,
    end,
    userId,
  })

  ctx.body = {
    data: result.items,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  }
}
