import type { Context } from 'koa'
import { inferDeviceFromUserAgent, recordAnalyticsEvent } from '@/services/analyticsService'

interface TrackEventBody {
  eventType?: string
  sceneId?: string
  sceneSpotId?: string
  sessionId?: string
  source?: string
  device?: string
  path?: string
  dwellMs?: number
  metadata?: Record<string, unknown>
}

export async function trackAnalyticsEvent(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as TrackEventBody
  if (!body.eventType || typeof body.eventType !== 'string') {
    ctx.throw(400, 'eventType is required')
    return
  }

  const userAgent = (ctx.get('User-Agent') || '').toString()
  const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim() : 'miniapp'
  const path = typeof body.path === 'string' && body.path.trim() ? body.path.trim() : ctx.path
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  const userId = ctx.state.miniAuthUser?.id

  await recordAnalyticsEvent({
    eventType: body.eventType,
    userId,
    sceneId: typeof body.sceneId === 'string' ? body.sceneId : undefined,
    sceneSpotId: typeof body.sceneSpotId === 'string' ? body.sceneSpotId : undefined,
    sessionId,
    source,
    device: body.device ? body.device : inferDeviceFromUserAgent(userAgent),
    path,
    dwellMs: typeof body.dwellMs === 'number' ? body.dwellMs : undefined,
    metadata: body.metadata,
  })

  ctx.body = { success: true }
}
