import type { Context } from 'koa'
import { MiniEventModel } from '@/models/MiniEvent'
import { objectIdString, asString } from './miniDtoUtils'

export async function listHotEvents(ctx: Context): Promise<void> {
  const now = new Date()
  const limitRaw = (ctx.query as { limit?: string }).limit
  const limit = Math.max(1, Math.min(50, Number(limitRaw ?? 20) || 20))

  const events = await MiniEventModel.find({
    $or: [
      { endAt: null },
      { endAt: { $gte: now } },
    ],
  })
    .sort({ hotScore: -1, startAt: 1, createdAt: -1 })
    .limit(limit)
    .lean()
    .exec()

  ctx.body = {
    total: events.length,
    events: events.map((event) => ({
      id: objectIdString(event._id),
      title: event.title,
      description: asString(event.description, ''),
      coverUrl: asString(event.coverUrl, ''),
      locationText: event.locationText ?? null,
      startAt: event.startAt ? event.startAt.toISOString() : null,
      endAt: event.endAt ? event.endAt.toISOString() : null,
      sceneId: event.sceneId ? objectIdString(event.sceneId) : null,
      hotScore: event.hotScore ?? 0,
    })),
  }
}
