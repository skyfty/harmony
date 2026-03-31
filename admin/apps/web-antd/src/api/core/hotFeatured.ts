import { requestClient } from '#/api/request'

interface ServerListResult<T> {
  data: T[]
  page?: number
  pageSize?: number
  total?: number
}

export interface HotFeaturedItem {
  id: string
  sceneSpotId: string
  sceneSpotTitle?: string | null
  order: number
  createdAt: string
  updatedAt: string
}

export async function listHotSpotsApi() {
  const res = await requestClient.get<ServerListResult<HotFeaturedItem>>('/admin/hot-spots')
  const data = res.data || []
  return { items: data, total: data.length }
}

export async function createHotSpotApi(payload: { sceneSpotId: string; order?: number }) {
  return requestClient.post<HotFeaturedItem>('/admin/hot-spots', payload)
}

export async function updateHotSpotApi(id: string, payload: { order?: number }) {
  return requestClient.put<HotFeaturedItem>(`/admin/hot-spots/${id}`, payload)
}

export async function deleteHotSpotApi(id: string) {
  return requestClient.delete(`/admin/hot-spots/${id}`)
}

export async function listFeaturedSpotsApi() {
  const res = await requestClient.get<ServerListResult<HotFeaturedItem>>('/admin/featured-spots')
  const data = res.data || []
  return { items: data, total: data.length }
}

export async function createFeaturedSpotApi(payload: { sceneSpotId: string; order?: number }) {
  return requestClient.post<HotFeaturedItem>('/admin/featured-spots', payload)
}

export async function updateFeaturedSpotApi(id: string, payload: { order?: number }) {
  return requestClient.put<HotFeaturedItem>(`/admin/featured-spots/${id}`, payload)
}

export async function deleteFeaturedSpotApi(id: string) {
  return requestClient.delete(`/admin/featured-spots/${id}`)
}
