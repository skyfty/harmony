import type { Context } from 'koa'
import { inferDeviceFromUserAgent, recordAnalyticsEvent } from '@/services/analyticsService'
import { parseRealSceneLocation, recordRealSceneCheckinByLocation } from '@/services/realSceneCheckinService'

interface TrackEventBody {
  eventType?: string
  sceneId?: string
  sceneSpotId?: string
  vehicleIdentifier?: string
  sessionId?: string
  source?: string
  device?: string
  path?: string
  dwellMs?: number
  latitude?: number
  longitude?: number
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
  const location = parseRealSceneLocation({
    latitude: body.latitude,
    longitude: body.longitude,
  })

  const metadata =
    location || body.metadata
      ? {
          ...(body.metadata ?? {}),
          ...(location
            ? {
                location: {
                  latitude: location.latitude,
                  longitude: location.longitude,
                },
              }
            : {}),
        }
      : undefined

  await recordAnalyticsEvent({
    eventType: body.eventType,
    userId,
    sceneId: typeof body.sceneId === 'string' ? body.sceneId : undefined,
    sceneSpotId: typeof body.sceneSpotId === 'string' ? body.sceneSpotId : undefined,
    vehicleIdentifier: typeof body.vehicleIdentifier === 'string' ? body.vehicleIdentifier : undefined,
    sessionId,
    source,
    device: body.device ? body.device : inferDeviceFromUserAgent(userAgent),
    path,
    dwellMs: typeof body.dwellMs === 'number' ? body.dwellMs : undefined,
    metadata,
  })

  if (body.eventType === 'real_scene_location' && location) {
    const match = await recordRealSceneCheckinByLocation({
      userId,
      location,
    })

    ctx.body = {
      success: true,
      matchedSceneSpotId: match?.sceneSpotId ?? null,
      matchedSceneSpotTitle: match?.title ?? null,
      matchedSceneId: match?.sceneId ?? null,
      matchedDistanceMeters: match ? Math.round(match.distanceMeters) : null,
    }
    return
  }

  ctx.body = { success: true }
}
