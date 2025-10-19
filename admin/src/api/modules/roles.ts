import { apiClient } from '@/api/http'
import type { PagedRequest, PagedResponse, RoleMutationPayload, RoleSummary } from '@/types'

export async function listRoles(params: PagedRequest = {}): Promise<PagedResponse<RoleSummary>> {
  const { data } = await apiClient.get<PagedResponse<RoleSummary>>('/api/roles', { params })
  return data
}

export async function getRole(id: string): Promise<RoleSummary> {
  const { data } = await apiClient.get<RoleSummary>(`/api/roles/${id}`)
  return data
}

export async function createRole(payload: RoleMutationPayload): Promise<RoleSummary> {
  const { data } = await apiClient.post<RoleSummary>('/api/roles', payload)
  return data
}

export async function updateRole(id: string, payload: RoleMutationPayload): Promise<RoleSummary> {
  const { data } = await apiClient.put<RoleSummary>(`/api/roles/${id}`, payload)
  return data
}

export async function removeRole(id: string): Promise<void> {
  await apiClient.delete(`/api/roles/${id}`)
}
