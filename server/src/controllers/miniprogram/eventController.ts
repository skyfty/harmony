import type { Context } from 'koa'
import { objectIdString, asString } from './miniDtoUtils'

export async function listHotEvents(ctx: Context): Promise<void> {
  const now = new Date()
  const limitRaw = (ctx.query as { limit?: string }).limit
  const limit = Math.max(1, Math.min(50, Number(limitRaw ?? 20) || 20))

  // MiniEvent functionality removed for now — return empty list
  ctx.body = {
    total: 0,
    events: [],
  }
}
