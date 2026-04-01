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

export interface AchievementItem {
  id: string
  name: string
  description?: string | null
  metadata?: Record<string, unknown> | null
  createdAt?: string | null
  updatedAt?: string | null
}

export interface RuleBriefItem {
  id: string
  name: string
  scenicId?: string | null
  enterScenic: boolean
  viewPercentage: number
  enabled: boolean
}

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return { items: result.data || [], total: result.total || 0 }
}

export async function listAchievementsApi(params?: { keyword?: string; page?: number; pageSize?: number }) {
  const response = await requestClient.get<ServerPageResult<AchievementItem>>('/admin/achievements', { params })
  return normalizeGridPage(response)
}

export async function getAchievementApi(id: string) {
  return requestClient.get<AchievementItem>(`/admin/achievements/${id}`)
}

export async function createAchievementApi(payload: { name: string; description?: string }) {
  return requestClient.post<AchievementItem>('/admin/achievements', payload)
}

export async function updateAchievementApi(id: string, payload: Partial<{ name: string; description?: string }>) {
  return requestClient.put<AchievementItem>(`/admin/achievements/${id}`, payload)
}

export async function deleteAchievementApi(id: string) {
  return requestClient.delete(`/admin/achievements/${id}`)
}

export async function listAchievementRulesApi(achievementId: string) {
  return requestClient.get<RuleBriefItem[]>(`/admin/achievements/${achievementId}/rules`)
}

export async function addRulesToAchievementApi(achievementId: string, ruleIds: string[]) {
  return requestClient.post(`/admin/achievements/${achievementId}/rules`, { ruleIds })
}

export async function removeRuleFromAchievementApi(achievementId: string, ruleId: string) {
  return requestClient.delete(`/admin/achievements/${achievementId}/rules/${ruleId}`)
}
