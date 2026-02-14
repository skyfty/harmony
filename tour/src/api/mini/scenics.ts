import type { ScenicDetail, ScenicSummary } from '@/types/scenic'
import { miniRequest } from './client'

export type ListScenicsResponse = {
  total: number
  sceneSpots: ScenicSummary[]
}

export async function listScenics(query?: { featured?: boolean; q?: string }): Promise<ScenicSummary[]> {
  const res = await miniRequest<ListScenicsResponse>('/scene-spots', {
    method: 'GET',
    query: {
      featured: query?.featured === undefined ? undefined : query.featured ? '1' : '0',
      q: query?.q,
    },
  })
  return Array.isArray(res.sceneSpots) ? res.sceneSpots : []
}

export type GetScenicResponse = {
  sceneSpot: ScenicDetail
}

export async function getScenic(id: string): Promise<ScenicDetail | null> {
  if (!id) return null
  const res = await miniRequest<GetScenicResponse>(`/scene-spots/${encodeURIComponent(id)}`, { method: 'GET' })
  return res?.sceneSpot ?? null
}
