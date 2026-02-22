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

export interface CreatePunchRecordPayload {
  sceneId: string
  sceneName: string
  clientPunchTime: string
  behaviorPunchTime?: string
  location: {
    nodeId: string
    nodeName: string
  }
  source?: string
  path?: string
}

export function trackAnalyticsEvent(payload: TrackAnalyticsEventPayload): Promise<{ success: boolean }> {
  return miniRequest<{ success: boolean }>('/analytics/events', {
    method: 'POST',
    body: payload,
  })
}

export function createPunchRecord(payload: CreatePunchRecordPayload): Promise<{ success: boolean; id: string }> {
  return miniRequest<{ success: boolean; id: string }>('/punch-records', {
    method: 'POST',
    body: payload,
  })
}
