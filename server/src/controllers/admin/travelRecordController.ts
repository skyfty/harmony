import type { Context } from 'koa'
import {
  deleteTravelRecordById,
  getTravelRecordById,
  queryTravelRecords,
} from '@/services/travelRecordService'

export async function listTravelRecords(ctx: Context): Promise<void> {
  const {
    page = '1',
    pageSize = '20',
    sceneId,
    sceneName,
    userId,
    username,
    status,
    start,
    end,
  } = ctx.query as Record<string, string>

  const result = await queryTravelRecords({
    page: Number(page),
    pageSize: Number(pageSize),
    sceneId,
    sceneName,
    userId,
    username,
    status: status === 'active' || status === 'completed' ? status : undefined,
    start,
    end,
  })

  ctx.body = {
    data: result.items,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  }
}

export async function getTravelRecord(ctx: Context): Promise<void> {
  const { id } = ctx.params
  const item = await getTravelRecordById(id)
  if (!item) {
    ctx.throw(404, 'Not found')
  }
  ctx.body = item
}

export async function deleteTravelRecord(ctx: Context): Promise<void> {
  const { id } = ctx.params
  const deleted = await deleteTravelRecordById(id)
  if (!deleted) {
    ctx.throw(404, 'Not found')
  }
  ctx.status = 200
  ctx.body = {}
}
