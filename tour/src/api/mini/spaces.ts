import type { ScenicDetail, ScenicSummary } from '@/types/scenic'
import { miniRequest } from './client'

export type ListSpacesResponse = {
  total: number
  spaces: ScenicSummary[]
}

export async function listSpaces(query?: { q?: string }): Promise<ScenicSummary[]> {
  const res = await miniRequest<ListSpacesResponse>('/spaces', {
    method: 'GET',
    query: { q: query?.q },
  })
  return Array.isArray(res.spaces) ? res.spaces : []
}

export type GetSpaceResponse = {
  space: ScenicDetail
  spots?: unknown[]
  events?: unknown[]
}

export async function getSpace(id: string): Promise<ScenicDetail | null> {
  if (!id) return null
  const res = await miniRequest<GetSpaceResponse>(`/spaces/${encodeURIComponent(id)}`, { method: 'GET' })
  return res?.space ?? null
}
