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

export interface LoginLogItem {
  id: string
  userId?: string
  username?: string
  action?: string
  success?: boolean
  ip?: string
  device?: string
  userAgent?: string
  note?: string
  createdAt: string
}

export interface ListLoginLogsParams {
  page?: number
  pageSize?: number
  username?: string
  userId?: string
  ip?: string
  success?: boolean
  start?: string
  end?: string
  keyword?: string
}

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return {
    items: result.data || [],
    total: result.total || 0,
  }
}

export async function listLoginLogsApi(params: ListLoginLogsParams) {
  const res = await requestClient.get<ServerPageResult<LoginLogItem>>('/admin/login-logs', { params })
  return normalizeGridPage(res)
}

export async function getLoginLogApi(id: string) {
  return requestClient.get<LoginLogItem>(`/admin/login-logs/${id}`)
}

export async function deleteLoginLogApi(id: string) {
  return requestClient.delete(`/admin/login-logs/${id}`)
}

export async function bulkDeleteLoginLogsApi(ids: string[]) {
  return requestClient.delete('/admin/login-logs', { data: { ids } })
}

export async function exportLoginLogsApi(params: ListLoginLogsParams) {
  // returns CSV blob via the base client
  const res = await requestClient.get('/admin/login-logs/export', { params, responseType: 'arraybuffer' })
  return res
}
