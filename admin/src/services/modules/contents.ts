import { apiClient } from '@/services/http'
import type { ContentEntry, ContentMutationPayload, PagedRequest, PagedResponse } from '@/types'

export async function listContents(params: PagedRequest = {}): Promise<PagedResponse<ContentEntry>> {
  const { data } = await apiClient.get<PagedResponse<ContentEntry>>('/api/contents', { params })
  return data
}

export async function getContent(id: string): Promise<ContentEntry> {
  const { data } = await apiClient.get<ContentEntry>(`/api/contents/${id}`)
  return data
}

export async function createContent(payload: ContentMutationPayload): Promise<ContentEntry> {
  const { data } = await apiClient.post<ContentEntry>('/api/contents', payload)
  return data
}

export async function updateContent(id: string, payload: ContentMutationPayload): Promise<ContentEntry> {
  const { data } = await apiClient.put<ContentEntry>(`/api/contents/${id}`, payload)
  return data
}

export async function removeContent(id: string): Promise<void> {
  await apiClient.delete(`/api/contents/${id}`)
}
