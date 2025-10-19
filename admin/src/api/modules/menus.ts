import { apiClient } from '@/api/http'
import type { MenuItem, MenuMutationPayload } from '@/types'

export async function listMenus(): Promise<MenuItem[]> {
  const { data } = await apiClient.get<MenuItem[]>('/api/menus')
  return data
}

export async function createMenu(payload: MenuMutationPayload): Promise<MenuItem> {
  const { data } = await apiClient.post<MenuItem>('/api/menus', payload)
  return data
}

export async function updateMenu(id: string, payload: MenuMutationPayload): Promise<MenuItem> {
  const { data } = await apiClient.put<MenuItem>(`/api/menus/${id}`, payload)
  return data
}

export async function removeMenu(id: string): Promise<void> {
  await apiClient.delete(`/api/menus/${id}`)
}
