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
  sceneName?: string
  nodeId?: string
  nodeName?: string
  userId?: string
  username?: string
  start?: string
  end?: string
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
