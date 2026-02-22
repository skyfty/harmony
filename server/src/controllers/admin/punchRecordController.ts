import type { Context } from 'koa'
import { queryPunchRecords } from '@/services/punchRecordService'

export async function listPunchRecords(ctx: Context): Promise<void> {
  const {
    page = '1',
    pageSize = '20',
    sceneId,
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
