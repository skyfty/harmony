import { miniRequest } from './client'

export type HotEvent = {
  id: string
  title: string
  description: string
  coverUrl: string
  locationText?: string | null
  startAt?: string | null
  endAt?: string | null
  sceneId?: string | null
  hotScore?: number
}

type HotEventsResponse = {
  total: number
  events: HotEvent[]
}

export async function listHotEvents(): Promise<HotEvent[]> {
  const res = await miniRequest<HotEventsResponse>('/events/hot', { method: 'GET' })
  return Array.isArray(res.events) ? res.events : []
}
