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

type ServerPunchRecordItem = {
  _id?: string
  id?: string
  userId?: string
  username?: string
  sceneId: string
  scenicId: string
  scenicTitle?: string
  sceneName?: string
  nodeId: string
  nodeName?: string
  clientPunchTime?: string
  behaviorPunchTime?: string
  source?: string
  path?: string
  ip?: string
  userAgent?: string
  createdAt: string
}

export interface PunchRecordItem {
  id: string
  userId?: string
  username?: string
  sceneId: string
  scenicId: string
  scenicTitle?: string
  sceneName?: string
  nodeId: string
  nodeName?: string
  clientPunchTime?: string
  behaviorPunchTime?: string
  source?: string
  path?: string
  ip?: string
  userAgent?: string
  createdAt: string
}

export interface ListPunchRecordsParams {
  page?: number
  pageSize?: number
  sceneId?: string
  scenicId?: string
  sceneName?: string
  nodeId?: string
  nodeName?: string
  userId?: string
  username?: string
  start?: string
  end?: string
}

export interface GetPunchRecordResponse extends PunchRecordItem {
  metadata?: Record<string, unknown>
}

function normalizeGridPage(result: ServerPageResult<ServerPunchRecordItem>): GridPageResult<PunchRecordItem> {
  const items = (result.data || []).map((entry) => ({
    ...entry,
    id: entry.id || entry._id || '',
  }))
  return {
    items,
    total: result.total || 0,
  }
}

export async function listPunchRecordsApi(params: ListPunchRecordsParams) {
  const res = await requestClient.get<ServerPageResult<ServerPunchRecordItem>>('/admin/punch-records', { params })
  return normalizeGridPage(res)
}

export async function getPunchRecordApi(id: string) {
  const res = await requestClient.get<GetPunchRecordResponse>(`/admin/punch-records/${id}`)
  return {
    ...res,
    id: res.id || (res as any)._id || '',
  }
}

export async function deletePunchRecordApi(id: string) {
  return await requestClient.delete(`/admin/punch-records/${id}`)
}
