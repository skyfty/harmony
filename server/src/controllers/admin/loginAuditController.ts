import type { Context } from 'koa'
import { queryLogs, getById, deleteById, deleteMany, exportCsv } from '@/services/loginAuditService'

export async function listLoginLogs(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '20', username, userId, ip, success, start, end, keyword } = ctx.query as Record<string, string>
  const result = await queryLogs({
    page: Number(page),
    pageSize: Number(pageSize),
    username,
    userId,
    ip,
    success,
    start,
    end,
    keyword,
  })
  ctx.body = {
    data: result.items,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  }
}

export async function getLoginLog(ctx: Context): Promise<void> {
  const { id } = ctx.params
  const item = await getById(id)
  if (!item) {
    ctx.throw(404, 'Not found')
  }
  ctx.body = item
}

export async function deleteLoginLog(ctx: Context): Promise<void> {
  const { id } = ctx.params
  const deleted = await deleteById(id)
  if (!deleted) {
    ctx.throw(404, 'Not found')
  }
  // Return explicit body to avoid client-side JSON parse errors when receiving 204 No Content
  ctx.status = 200
  ctx.body = {}
}

export async function bulkDeleteLoginLogs(ctx: Context): Promise<void> {
  const { ids } = ctx.request.body as { ids?: string[] }
  if (!Array.isArray(ids) || !ids.length) {
    ctx.throw(400, 'ids required')
  }
  const deleted = await deleteMany(ids)
  ctx.body = { deleted }
}

export async function exportLoginLogs(ctx: Context): Promise<void> {
  const { username, userId, ip, success, start, end, keyword } = ctx.query as Record<string, string>
  const csv = await exportCsv({ username, userId, ip, success, start, end, keyword })
  const filename = `login-logs-${start ?? 'all'}-${end ?? 'all'}.csv`
  ctx.set('Content-Type', 'text/csv; charset=utf-8')
  ctx.set('Content-Disposition', `attachment; filename=${filename}`)
  ctx.body = csv
}
