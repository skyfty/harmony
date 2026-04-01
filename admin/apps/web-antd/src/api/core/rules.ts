import { requestClient } from '#/api/request'

export interface RuleItem {
  id: string
  name: string
  scenicId?: string | null
  enterScenic: boolean
  viewPercentage: number
  enabled: boolean
  metadata?: Record<string, unknown> | null
  createdAt?: string | null
  updatedAt?: string | null
}

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

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return { items: result.data || [], total: result.total || 0 }
}

export async function listRulesApi(params?: { keyword?: string; page?: number; pageSize?: number }) {
  const response = await requestClient.get<ServerPageResult<RuleItem>>('/admin/rules', { params })
  return normalizeGridPage(response)
}

export async function getRuleApi(id: string) {
  return requestClient.get<RuleItem>(`/admin/rules/${id}`)
}

export async function createRuleApi(payload: { name: string; scenicId?: string | null; enterScenic?: boolean; viewPercentage?: number }) {
  return requestClient.post<RuleItem>('/admin/rules', payload)
}

export async function updateRuleApi(id: string, payload: Partial<{ name: string; scenicId?: string | null; enterScenic?: boolean; viewPercentage?: number; enabled?: boolean }>) {
  return requestClient.put<RuleItem>(`/admin/rules/${id}`, payload)
}

export async function deleteRuleApi(id: string) {
  return requestClient.delete(`/admin/rules/${id}`)
}
