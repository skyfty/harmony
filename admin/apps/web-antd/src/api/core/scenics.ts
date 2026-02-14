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

export interface ScenicItem {
  id: string
  name: string
  fileKey: string
  fileUrl: string
  fileSize: number
  fileType?: string | null
  originalFilename?: string | null
  publishedBy?: string | null
  createdAt: string
  updatedAt: string
}

export interface SceneSpotItem {
  id: string
  sceneId: string
  title: string
  coverImage?: string | null
  slides: string[]
  description: string
  address: string
  order: number
  createdAt: string
  updatedAt: string
}

export interface ScenicCreatePayload {
  name: string
  file?: Blob | File | null
}

export interface ScenicUpdatePayload {
  name?: string
  file?: Blob | File | null
}

export interface SceneSpotCreatePayload {
  title: string
  coverImage?: string | null
  slides?: string[] | string
  description?: string | null
  address?: string | null
  order?: number
}

export interface SceneSpotUpdatePayload {
  title?: string
  coverImage?: string | null
  slides?: string[] | string
  description?: string | null
  address?: string | null
  order?: number
}

export interface ListScenicsParams {
  keyword?: string
  page?: number
  pageSize?: number
}

function appendField(form: FormData, key: string, value: null | string | undefined) {
  if (value === undefined) {
    return
  }
  form.append(key, value ?? '')
}

function toScenicFormData(payload: ScenicCreatePayload | ScenicUpdatePayload): FormData {
  const form = new FormData()
  appendField(form, 'name', payload.name)
  if (payload.file) {
    form.append('file', payload.file)
  }
  return form
}

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return {
    items: result.data || [],
    total: result.total || 0,
  }
}

export async function listScenicsApi(params: ListScenicsParams) {
  const response = await requestClient.get<ServerPageResult<ScenicItem>>('/admin/scenes', {
    params,
  })
  return normalizeGridPage(response)
}

export async function getScenicApi(id: string) {
  return requestClient.get<ScenicItem>(`/admin/scenes/${id}`)
}

export async function createScenicApi(payload: FormData | ScenicCreatePayload) {
  const data = payload instanceof FormData ? payload : toScenicFormData(payload)
  return requestClient.post<ScenicItem>('/admin/scenes', data, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
}

export async function updateScenicApi(id: string, payload: FormData | ScenicUpdatePayload) {
  const data = payload instanceof FormData ? payload : toScenicFormData(payload)
  return requestClient.put<ScenicItem>(`/admin/scenes/${id}`, data, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
}

export async function deleteScenicApi(id: string) {
  return requestClient.delete(`/admin/scenes/${id}`)
}

export async function listSceneSpotsApi(sceneId: string) {
  return requestClient.get<SceneSpotItem[]>(`/admin/scenes/${sceneId}/spots`)
}

export async function getSceneSpotApi(sceneId: string, id: string) {
  return requestClient.get<SceneSpotItem>(`/admin/scenes/${sceneId}/spots/${id}`)
}

export async function createSceneSpotApi(sceneId: string, payload: SceneSpotCreatePayload) {
  return requestClient.post<SceneSpotItem>(`/admin/scenes/${sceneId}/spots`, payload)
}

export async function updateSceneSpotApi(sceneId: string, id: string, payload: SceneSpotUpdatePayload) {
  return requestClient.put<SceneSpotItem>(`/admin/scenes/${sceneId}/spots/${id}`, payload)
}

export async function deleteSceneSpotApi(sceneId: string, id: string) {
  return requestClient.delete(`/admin/scenes/${sceneId}/spots/${id}`)
}
