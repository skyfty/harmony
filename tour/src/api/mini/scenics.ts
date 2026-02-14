import type { ScenicDetail, ScenicSummary } from '@/types/scenic'
import { miniRequest } from './client'

export type ListScenicsResponse = {
  total: number
  scenics: ScenicSummary[]
}

export async function listScenics(query?: { q?: string }): Promise<ScenicSummary[]> {
  const res = await miniRequest<ListScenicsResponse>('/scenics', {
    method: 'GET',
    query: { q: query?.q },
  })
  return Array.isArray(res.scenics) ? res.scenics : []
}

export type GetScenicResponse = {
  scenic: ScenicDetail
  spots?: unknown[]
  events?: unknown[]
}

export async function getScenic(id: string): Promise<ScenicDetail | null> {
  if (!id) return null
  const res = await miniRequest<GetScenicResponse>(`/scenics/${encodeURIComponent(id)}`, { method: 'GET' })
  return res?.scenic ?? null
}
