import { apiClient } from '@/services/http'
import type { PagedRequest, PagedResponse, UserMutationPayload, UserSummary } from '@/types'

export async function listUsers(params: PagedRequest = {}): Promise<PagedResponse<UserSummary>> {
  const { data } = await apiClient.get<PagedResponse<UserSummary>>('/api/users', { params })
  return data
}

export async function getUser(id: string): Promise<UserSummary> {
  const { data } = await apiClient.get<UserSummary>(`/api/users/${id}`)
  return data
}

export async function createUser(payload: UserMutationPayload): Promise<UserSummary> {
  const { data } = await apiClient.post<UserSummary>('/api/users', payload)
  return data
}

export async function updateUser(id: string, payload: UserMutationPayload): Promise<UserSummary> {
  const { data } = await apiClient.put<UserSummary>(`/api/users/${id}`, payload)
  return data
}

export async function removeUser(id: string): Promise<void> {
  await apiClient.delete(`/api/users/${id}`)
}

export async function updateUserStatus(id: string, status: 'active' | 'disabled'): Promise<UserSummary> {
  const { data } = await apiClient.patch<UserSummary>(`/api/users/${id}/status`, { status })
  return data
}
