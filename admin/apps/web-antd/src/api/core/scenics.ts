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
  location?: string | null
  intro?: string | null
  url?: string | null
  fileKey?: string
  fileUrl?: string
  description?: string | null
  metadata?: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export type ScenicMetadata = Record<string, unknown>

export interface ScenicCreatePayload {
  name: string
  location?: null | string
  intro?: null | string
  url?: null | string
  description?: null | string
  metadata?: ScenicMetadata | null
  file?: Blob | File | null
}

export interface ScenicUpdatePayload {
  name?: string
  location?: null | string
  intro?: null | string
  url?: null | string
  description?: null | string
  metadata?: ScenicMetadata | null
  file?: Blob | File | null
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
  appendField(form, 'location', payload.location)
  appendField(form, 'intro', payload.intro)
  appendField(form, 'url', payload.url)
  appendField(form, 'description', payload.description)
  if (Object.prototype.hasOwnProperty.call(payload, 'metadata')) {
    form.append('metadata', payload.metadata == null ? '' : JSON.stringify(payload.metadata))
  }
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
  const response = await requestClient.get<ServerPageResult<ScenicItem>>('/admin/scenics', {
    params,
  })
  return normalizeGridPage(response)
}

export async function getScenicApi(id: string) {
  return requestClient.get<ScenicItem>(`/admin/scenics/${id}`)
}

export async function createScenicApi(payload: FormData | ScenicCreatePayload) {
  const data = payload instanceof FormData ? payload : toScenicFormData(payload)
  return requestClient.post<ScenicItem>('/admin/scenics', data, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
}

export async function updateScenicApi(id: string, payload: FormData | ScenicUpdatePayload) {
  const data = payload instanceof FormData ? payload : toScenicFormData(payload)
  return requestClient.put<ScenicItem>(`/admin/scenics/${id}`, data, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
}

export async function deleteScenicApi(id: string) {
  return requestClient.delete(`/admin/scenics/${id}`)
}
