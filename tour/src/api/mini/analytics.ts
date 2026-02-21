import { miniRequest } from './client'

export interface TrackAnalyticsEventPayload {
  eventType: string
  sceneId?: string
  sceneSpotId?: string
  sessionId?: string
  source?: string
  device?: string
  path?: string
  dwellMs?: number
  metadata?: Record<string, unknown>
}

export function trackAnalyticsEvent(payload: TrackAnalyticsEventPayload): Promise<{ success: boolean }> {
  return miniRequest<{ success: boolean }>('/analytics/events', {
    method: 'POST',
    body: payload,
  })
}
