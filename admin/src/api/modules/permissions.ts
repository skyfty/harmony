import { apiClient } from '@/api/http'
import type { PagedRequest, PagedResponse, PermissionMutationPayload, PermissionSummary } from '@/types'

export async function listPermissions(params: PagedRequest = {}): Promise<PagedResponse<PermissionSummary>> {
  const { data } = await apiClient.get<PagedResponse<PermissionSummary>>('/api/permissions', { params })
  return data
}

export async function createPermission(payload: PermissionMutationPayload): Promise<PermissionSummary> {
  const { data } = await apiClient.post<PermissionSummary>('/api/permissions', payload)
  return data
}

export async function updatePermission(id: string, payload: PermissionMutationPayload): Promise<PermissionSummary> {
  const { data } = await apiClient.put<PermissionSummary>(`/api/permissions/${id}`, payload)
  return data
}

export async function removePermission(id: string): Promise<void> {
  await apiClient.delete(`/api/permissions/${id}`)
}
