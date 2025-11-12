import { buildServerApiUrl } from './serverApiConfig'
import type { ProjectAsset } from '@/types/project-asset'
import {
  mapServerAssetToProjectAsset,
  type ServerAssetDto,
  type ServerAssetTagDto,
} from './serverAssetTypes'
import { useAuthStore } from '@/stores/authStore'

export interface GenerateAssetTagPayload {
  name?: string
  description?: string
  assetType?: ProjectAsset['type']
  extraHints?: string[]
}

export interface GenerateAssetTagResult {
  tags: string[]
  transcript?: string | null
  imagePrompt?: string | null
  modelTraceId?: string
}

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

export async function generateAssetTagSuggestions(payload: GenerateAssetTagPayload): Promise<GenerateAssetTagResult> {
  const url = buildServerApiUrl('/ai/tags/suggest')
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
    body: JSON.stringify(payload ?? {}),
  })

  if (!response.ok) {
    const errorBody = await parseJsonResponse<{ message?: string } | string | null>(response).catch(() => null)
    const message = typeof errorBody === 'string' ? errorBody : errorBody?.message
    throw buildError(message || '生成标签失败', response)
  }

  const body = await parseJsonResponse<{ data?: GenerateAssetTagResult }>(response)
  if (!body?.data || !Array.isArray(body.data.tags)) {
    throw new Error('AI 标签响应格式无效')
  }
  return {
    tags: body.data.tags.filter((tag): tag is string => typeof tag === 'string'),
    transcript: body.data.transcript ?? null,
    imagePrompt: body.data.imagePrompt ?? null,
    modelTraceId: body.data.modelTraceId,
  }
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

type CreateAssetTagResponse = {
  tags?: ServerAssetTagDto[] | null
  createdTagIds?: string[] | null
}

export async function createAssetTag(payload: {
  name?: string
  names?: string[]
  description?: string
}): Promise<AssetTagSummary[]> {
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
  const nameSet = new Set<string>()
  if (Array.isArray(payload.names)) {
    payload.names
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0)
      .forEach((value) => {
        nameSet.add(value)
      })
  }
  if (typeof payload.name === 'string') {
    const trimmed = payload.name.trim()
    if (trimmed.length > 0) {
      nameSet.add(trimmed)
    }
  }
  if (nameSet.size === 0) {
    throw new Error('标签名称不能为空')
  }
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      names: Array.from(nameSet),
      description: payload.description,
    }),
  })
  if (!response.ok) {
    const errorBody = await parseJsonResponse<{ message?: string } | string | null>(response).catch(() => null)
    const message = typeof errorBody === 'string' ? errorBody : errorBody?.message
    throw new Error(message || `创建标签失败（${response.status}）`)
  }
  const payloadBody = await parseJsonResponse<CreateAssetTagResponse>(response)
  const tags = Array.isArray(payloadBody?.tags)
    ? payloadBody.tags.filter((tag): tag is ServerAssetTagDto => !!tag && typeof tag.id === 'string' && typeof tag.name === 'string')
    : []
  if (!tags.length) {
    throw new Error('服务器返回的标签数据无效')
  }
  return tags.map((tag) => normalizeTagSummary(tag))
}

export interface UploadAssetOptions {
  file: File
  name: string
  type: ProjectAsset['type']
  description?: string
  tagIds?: string[]
  color?: string | null
  dimensionLength?: number | null
  dimensionWidth?: number | null
  dimensionHeight?: number | null
  imageWidth?: number | null
  imageHeight?: number | null
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
  if (typeof options.color === 'string' && options.color.trim().length) {
    formData.append('color', options.color.trim())
  }
  if (typeof options.dimensionLength === 'number' && Number.isFinite(options.dimensionLength)) {
    formData.append('dimensionLength', options.dimensionLength.toString())
  }
  if (typeof options.dimensionWidth === 'number' && Number.isFinite(options.dimensionWidth)) {
    formData.append('dimensionWidth', options.dimensionWidth.toString())
  }
  if (typeof options.dimensionHeight === 'number' && Number.isFinite(options.dimensionHeight)) {
    formData.append('dimensionHeight', options.dimensionHeight.toString())
  }
  if (typeof options.imageWidth === 'number' && Number.isFinite(options.imageWidth)) {
    formData.append('imageWidth', Math.round(options.imageWidth).toString())
  }
  if (typeof options.imageHeight === 'number' && Number.isFinite(options.imageHeight)) {
    formData.append('imageHeight', Math.round(options.imageHeight).toString())
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
