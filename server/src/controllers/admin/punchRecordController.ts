import type { Context } from 'koa'
import { deletePunchRecordById, getPunchRecordById, queryPunchRecords } from '@/services/punchRecordService'

export async function listPunchRecords(ctx: Context): Promise<void> {
  const {
    page = '1',
    pageSize = '20',
    sceneId,
    scenicId,
    sceneName,
    nodeId,
    nodeName,
    userId,
    username,
    start,
    end,
  } = ctx.query as Record<string, string>

  const result = await queryPunchRecords({
    page: Number(page),
    pageSize: Number(pageSize),
    sceneId,
    scenicId,
    sceneName,
    nodeId,
    nodeName,
    userId,
    username,
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

export async function getPunchRecord(ctx: Context): Promise<void> {
  const { id } = ctx.params
  const item = await getPunchRecordById(id)
  if (!item) {
    ctx.throw(404, 'Not found')
  }
  ctx.body = item
}

export async function deletePunchRecord(ctx: Context): Promise<void> {
  const { id } = ctx.params
  const deleted = await deletePunchRecordById(id)
  if (!deleted) {
    ctx.throw(404, 'Not found')
  }
  ctx.status = 200
  ctx.body = {}
}
