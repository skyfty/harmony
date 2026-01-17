import { buildServerApiUrl } from './serverApiConfig'
import type { TerrainScatterCategory } from '@harmony/schema/terrain-scatter'
import type { ProjectAsset } from '@/types/project-asset'
import type { ResourceCategory } from '@/types/resource-category'
import type { AssetSeries } from '@/types/asset-series'
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

export interface ResourceCategorySearchResult extends ResourceCategory {}

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

function collectCategoryMap(target: Map<string, ResourceCategory>, categories: ResourceCategory[]): void {
  categories.forEach((category) => {
    if (!category || typeof category.id !== 'string') {
      return
    }
    target.set(category.id, category)
    if (Array.isArray(category.children) && category.children.length > 0) {
      collectCategoryMap(target, category.children)
    }
  })
}

export async function fetchResourceCategories(): Promise<ResourceCategory[]> {
  const url = buildServerApiUrl('/resources/categories')
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
    throw buildError('获取资源分类失败', response)
  }
  const payload = await parseJsonResponse<ResourceCategory[]>(response)
  if (!Array.isArray(payload)) {
    throw new Error('资源分类数据格式无效')
  }
  return payload.filter((category): category is ResourceCategory => !!category && typeof category.id === 'string')
}

export async function searchResourceCategories(keyword: string, limit = 20): Promise<ResourceCategorySearchResult[]> {
  const trimmed = keyword.trim()
  if (!trimmed.length) {
    return []
  }
  const url = buildServerApiUrl('/resources/categories/search')
  const authStore = useAuthStore()
  const headers = new Headers({ Accept: 'application/json' })
  const authorization = authStore.authorizationHeader
  if (authorization) {
    headers.set('Authorization', authorization)
  }

  const response = await fetch(url + `?keyword=${encodeURIComponent(trimmed)}&limit=${limit}`, {
    method: 'GET',
    credentials: 'include',
    headers,
    cache: 'no-cache',
  })
  if (!response.ok) {
    throw buildError('搜索资源分类失败', response)
  }
  const payload = await parseJsonResponse<ResourceCategory[]>(response)
  if (!Array.isArray(payload)) {
    return []
  }
  const unique = new Map<string, ResourceCategory>()
  collectCategoryMap(unique, payload)
  return Array.from(unique.values())
}

export interface CreateResourceCategoryPayload {
  path?: string[]
  segments?: string[]
  names?: string[]
  name?: string
  parentId?: string | null
  description?: string | null
}

export async function createResourceCategory(payload: CreateResourceCategoryPayload): Promise<ResourceCategory> {
  const url = buildServerApiUrl('/resources/categories')
  const authStore = useAuthStore()
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  })
  const authorization = authStore.authorizationHeader
  if (authorization) {
    headers.set('Authorization', authorization)
  }

  const body: Record<string, unknown> = {}
  if (Array.isArray(payload.path)) {
    body.path = payload.path
  } else if (Array.isArray(payload.segments)) {
    body.path = payload.segments
  } else if (Array.isArray(payload.names)) {
    body.path = payload.names
  }
  if (typeof payload.name === 'string') {
    body.name = payload.name
  }
  if (payload.parentId === null) {
    body.parentId = null
  } else if (typeof payload.parentId === 'string') {
    body.parentId = payload.parentId
  }
  if (typeof payload.description === 'string') {
    body.description = payload.description
  }

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const errorBody = await parseJsonResponse<{ message?: string } | string | null>(response).catch(() => null)
    const message = typeof errorBody === 'string' ? errorBody : errorBody?.message
    throw new Error(message || `创建分类失败（${response.status}）`)
  }

  const payloadBody = await parseJsonResponse<ResourceCategory>(response)
  if (!payloadBody || typeof payloadBody.id !== 'string') {
    throw new Error('服务器返回的分类数据无效')
  }
  return payloadBody
}

export async function fetchAssetSeries(): Promise<AssetSeries[]> {
  const url = buildServerApiUrl('/resources/series')
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
    throw buildError('获取资源系列失败', response)
  }
  const payload = await parseJsonResponse<AssetSeries[]>(response)
  if (!Array.isArray(payload)) {
    throw new Error('资源系列数据格式无效')
  }
  return payload.filter((series): series is AssetSeries => !!series && typeof series.id === 'string')
}

export async function createAssetSeries(payload: { name: string; description?: string | null }): Promise<AssetSeries> {
  const url = buildServerApiUrl('/resources/series')
  const authStore = useAuthStore()
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  })
  const authorization = authStore.authorizationHeader
  if (authorization) {
    headers.set('Authorization', authorization)
  }

  if (typeof payload.name !== 'string' || !payload.name.trim().length) {
    throw new Error('系列名称不能为空')
  }

  const body: Record<string, unknown> = {
    name: payload.name.trim(),
  }
  if (payload.description !== undefined) {
    body.description = payload.description ? payload.description.trim() : null
  }

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const errorBody = await parseJsonResponse<{ message?: string } | string | null>(response).catch(() => null)
    const message = typeof errorBody === 'string' ? errorBody : errorBody?.message
    throw new Error(message || `创建系列失败（${response.status}）`)
  }

  const payloadBody = await parseJsonResponse<AssetSeries>(response)
  if (!payloadBody || typeof payloadBody.id !== 'string') {
    throw new Error('服务器返回的系列数据无效')
  }
  return payloadBody
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
  thumbnailFile?: File | null
  name: string
  type: ProjectAsset['type']
  description?: string
  tagIds?: string[]
  categoryId?: string | null
  categoryPathSegments?: string[]
  color?: string | null
  dimensionLength?: number | null
  dimensionWidth?: number | null
  dimensionHeight?: number | null
  imageWidth?: number | null
  imageHeight?: number | null
  seriesId?: string | null
  terrainScatterPreset?: TerrainScatterCategory | null
  mixtureType?: string | null
}

export async function uploadAssetToServer(options: UploadAssetOptions): Promise<ServerAssetDto> {
  const url = buildServerApiUrl('/resources/assets')
  const formData = new FormData()
  formData.append('file', options.file)
  if (options.thumbnailFile) {
    const thumbnailName = options.thumbnailFile.name && options.thumbnailFile.name.trim().length ? options.thumbnailFile.name : 'thumbnail.png'
    formData.append('thumbnail', options.thumbnailFile, thumbnailName)
  }
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
  if (typeof options.categoryId === 'string' && options.categoryId.trim().length) {
    formData.append('categoryId', options.categoryId.trim())
  }
  if (typeof options.seriesId === 'string' && options.seriesId.trim().length) {
    formData.append('seriesId', options.seriesId.trim())
  }
  if (typeof options.terrainScatterPreset === 'string' && options.terrainScatterPreset.trim().length) {
    formData.append('terrainScatterPreset', options.terrainScatterPreset.trim())
  }
  if (typeof options.mixtureType === 'string' && options.mixtureType.trim().length) {
    formData.append('mixtureType', options.mixtureType.trim())
  }
  if (Array.isArray(options.categoryPathSegments)) {
    options.categoryPathSegments
      .map((segment) => (typeof segment === 'string' ? segment.trim() : ''))
      .filter((segment) => segment.length > 0)
      .forEach((segment) => formData.append('categoryPathSegments', segment))
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
