import { buildServerApiUrl } from './serverApiConfig'
import type { ProjectAsset } from '@/types/project-asset'
import {
  mapServerAssetToProjectAsset,
  type ServerAssetDto,
  type ServerAssetTagDto,
} from './serverAssetTypes'
import { useAuthStore } from '@/stores/authStore'

export interface AssetTagSummary {
  id: string
  name: string
  description?: string
}

function normalizeTagSummary(tag: ServerAssetTagDto): AssetTagSummary {
  return {
    id: tag.id,
    name: tag.name,
    description: tag.description ?? undefined,
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return (await response.json()) as T
  }
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch (_error) {
    throw new Error(text || '服务器响应格式不正确')
  }
}

function buildError(message: string, response?: Response): Error {
  if (!response) {
    return new Error(message)
  }
  return new Error(`${message}（${response.status}）`)
}

export async function fetchAssetTags(): Promise<AssetTagSummary[]> {
  const url = buildServerApiUrl('/resources/tags')
  const authStore = useAuthStore()
  const headers = new Headers({ Accept: 'application/json' })
  const authorization = authStore.authorizationHeader
  if (authorization) {
    headers.set('Authorization', authorization)
  }
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers,
    cache: 'no-cache',
  })
  if (!response.ok) {
    throw buildError('获取标签列表失败', response)
  }
  const payload = await parseJsonResponse<ServerAssetTagDto[]>(response)
  if (!Array.isArray(payload)) {
    throw new Error('标签列表格式不正确')
  }
  return payload
    .filter((tag): tag is ServerAssetTagDto => !!tag && typeof tag.id === 'string' && typeof tag.name === 'string')
    .map((tag) => normalizeTagSummary(tag))
}

export async function createAssetTag(payload: { name: string; description?: string }): Promise<AssetTagSummary> {
  const url = buildServerApiUrl('/resources/tags')
  const authStore = useAuthStore()
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  })
  const authorization = authStore.authorizationHeader
  if (authorization) {
    headers.set('Authorization', authorization)
  }
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      name: payload.name,
      description: payload.description,
    }),
  })
  if (!response.ok) {
    const errorBody = await parseJsonResponse<{ message?: string } | string | null>(response).catch(() => null)
    const message = typeof errorBody === 'string' ? errorBody : errorBody?.message
    throw new Error(message || `创建标签失败（${response.status}）`)
  }
  const tag = await parseJsonResponse<ServerAssetTagDto>(response)
  if (!tag || typeof tag.id !== 'string' || typeof tag.name !== 'string') {
    throw new Error('服务器返回的标签数据无效')
  }
  return normalizeTagSummary(tag)
}

export interface UploadAssetOptions {
  file: File
  name: string
  type: ProjectAsset['type']
  description?: string
  tagIds?: string[]
}

export async function uploadAssetToServer(options: UploadAssetOptions): Promise<ServerAssetDto> {
  const url = buildServerApiUrl('/resources/assets')
  const formData = new FormData()
  formData.append('file', options.file)
  formData.append('name', options.name)
  formData.append('type', options.type)
  if (options.description) {
    formData.append('description', options.description)
  }
  if (Array.isArray(options.tagIds)) {
    options.tagIds
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      .forEach((id) => {
        formData.append('tagIds', id)
      })
  }

  const authStore = useAuthStore()
  const headers = new Headers()
  const authorization = authStore.authorizationHeader
  if (authorization) {
    headers.set('Authorization', authorization)
  }

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: formData,
  })
  if (!response.ok) {
    const errorBody = await parseJsonResponse<{ message?: string } | string | null>(response).catch(() => null)
    const message = typeof errorBody === 'string' ? errorBody : errorBody?.message
    throw new Error(message || `上传资源失败（${response.status}）`)
  }

  const payload = await parseJsonResponse<{ asset?: ServerAssetDto }>(response)
  if (!payload?.asset) {
    throw new Error('服务器返回的资源数据无效')
  }
  return payload.asset
}

export { mapServerAssetToProjectAsset }
