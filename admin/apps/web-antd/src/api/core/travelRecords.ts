import { requestClient } from '#/api/request'

interface ServerPageResult<T> {
  data: T[]
  page: number
  pageSize: number
  total: number
}

interface GridPageResult<T> {
  items: T[]
  total: number
}

type ServerTravelRecordItem = {
  _id?: string
  id?: string
  userId?: string
  username?: string
  sceneId: string
  scenicId: string
  scenicTitle?: string
  sceneName?: string
  enterTime: string
  leaveTime?: string
  durationSeconds?: number
  achievementCount?: number
  status: 'active' | 'completed'
  source?: string
  path?: string
  ip?: string
  userAgent?: string
  createdAt: string
}

export interface TravelRecordItem {
  id: string
  userId?: string
  username?: string
  sceneId: string
  scenicId: string
  scenicTitle?: string
  sceneName?: string
  enterTime: string
  leaveTime?: string
  durationSeconds?: number
  achievementCount?: number
  status: 'active' | 'completed'
  source?: string
  path?: string
  ip?: string
  userAgent?: string
  createdAt: string
}

export interface ListTravelRecordsParams {
  page?: number
  pageSize?: number
  sceneId?: string
  scenicId?: string
  sceneName?: string
  userId?: string
  username?: string
  status?: 'active' | 'completed'
  start?: string
  end?: string
}

export interface GetTravelRecordResponse extends TravelRecordItem {
  metadata?: Record<string, unknown>
}

function normalizeGridPage(result: ServerPageResult<ServerTravelRecordItem>): GridPageResult<TravelRecordItem> {
  const items = (result.data || []).map((entry) => ({
    ...entry,
    id: entry.id || entry._id || '',
  }))
  return {
    items,
    total: result.total || 0,
  }
}

export async function listTravelRecordsApi(params: ListTravelRecordsParams) {
  const res = await requestClient.get<ServerPageResult<ServerTravelRecordItem>>('/admin/travel-records', { params })
  return normalizeGridPage(res)
}

export async function getTravelRecordApi(id: string) {
  const res = await requestClient.get<GetTravelRecordResponse>(`/admin/travel-records/${id}`)
  return {
    ...res,
    id: res.id || (res as any)._id || '',
  }
}

export async function deleteTravelRecordApi(id: string) {
  return await requestClient.delete(`/admin/travel-records/${id}`)
}
