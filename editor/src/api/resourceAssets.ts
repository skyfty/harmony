import { buildServerApiUrl } from './serverApiConfig'
import type { AssetBundleHashAlgorithm, AssetBundleUploadResponse, AssetHashLookupResponse } from '@schema'
import type { TerrainScatterCategory } from '@schema/terrain-scatter'
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

type ApiEnvelope<T> = {
  code: number
  data: T
  message: string
}

function isApiEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Record<string, unknown>
  return typeof candidate.code === 'number' && 'data' in candidate && typeof candidate.message === 'string'
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
    const payload = (await response.json()) as unknown
    if (response.ok && isApiEnvelope<T>(payload)) {
      return payload.data
    }
    return payload as T
  }
  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as unknown
    if (response.ok && isApiEnvelope<T>(parsed)) {
      return parsed.data
    }
    return parsed as T
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

export interface UpdateResourceCategoryPayload {
  name?: string
  description?: string | null
}

export async function updateResourceCategory(
  categoryId: string,
  payload: UpdateResourceCategoryPayload,
): Promise<ResourceCategory> {
  const trimmed = categoryId.trim()
  if (!trimmed.length) {
    throw new Error('分类 id 不能为空')
  }

  const url = buildServerApiUrl(`/resources/categories/${encodeURIComponent(trimmed)}`)
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
  if (typeof payload.name === 'string') {
    body.name = payload.name
  }
  if (payload.description !== undefined) {
    body.description = payload.description ?? null
  }

  const response = await fetch(url, {
    method: 'PUT',
    credentials: 'include',
    headers,
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const errorBody = await parseJsonResponse<{ message?: string } | string | null>(response).catch(() => null)
    const message = typeof errorBody === 'string' ? errorBody : errorBody?.message
    throw new Error(message || `更新分类失败（${response.status}）`)
  }

  const payloadBody = await parseJsonResponse<ResourceCategory>(response)
  if (!payloadBody || typeof payloadBody.id !== 'string') {
    throw new Error('服务器返回的分类数据无效')
  }
  return payloadBody
}

export async function deleteResourceCategory(categoryId: string): Promise<void> {
  const trimmed = categoryId.trim()
  if (!trimmed.length) {
    throw new Error('分类 id 不能为空')
  }

  const url = buildServerApiUrl(`/resources/categories/${encodeURIComponent(trimmed)}`)
  const authStore = useAuthStore()
  const headers = new Headers({ Accept: 'application/json' })
  const authorization = authStore.authorizationHeader
  if (authorization) {
    headers.set('Authorization', authorization)
  }

  const response = await fetch(url, {
    method: 'DELETE',
    credentials: 'include',
    headers,
  })
  if (!response.ok) {
    const errorBody = await parseJsonResponse<{ message?: string } | string | null>(response).catch(() => null)
    const message = typeof errorBody === 'string' ? errorBody : errorBody?.message
    throw new Error(message || `删除分类失败（${response.status}）`)
  }
}

export async function moveResourceCategory(categoryId: string, targetParentId: string | null): Promise<ResourceCategory> {
  const trimmed = categoryId.trim()
  if (!trimmed.length) {
    throw new Error('分类 id 不能为空')
  }

  const url = buildServerApiUrl(`/resources/categories/${encodeURIComponent(trimmed)}/move`)
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
    body: JSON.stringify({ targetParentId }),
  })
  if (!response.ok) {
    const errorBody = await parseJsonResponse<{ message?: string } | string | null>(response).catch(() => null)
    const message = typeof errorBody === 'string' ? errorBody : errorBody?.message
    throw new Error(message || `移动分类失败（${response.status}）`)
  }

  const payloadBody = await parseJsonResponse<ResourceCategory>(response)
  if (!payloadBody || typeof payloadBody.id !== 'string') {
    throw new Error('服务器返回的分类数据无效')
  }
  return payloadBody
}

export interface BulkMoveResourceAssetsPayload {
  assetIds?: string[]
  fromCategoryId?: string | null
  includeDescendants?: boolean
  targetCategoryId: string
}

export interface BulkMoveResourceAssetsResult {
  matchedCount?: number
  modifiedCount: number
}

export async function bulkMoveResourceAssets(
  payload: BulkMoveResourceAssetsPayload,
): Promise<BulkMoveResourceAssetsResult> {
  const targetCategoryId = payload.targetCategoryId.trim()
  if (!targetCategoryId.length) {
    throw new Error('目标分类 id 不能为空')
  }

  const url = buildServerApiUrl('/resources/assets/bulk-move-category')
  const authStore = useAuthStore()
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  })
  const authorization = authStore.authorizationHeader
  if (authorization) {
    headers.set('Authorization', authorization)
  }

  const body: Record<string, unknown> = {
    targetCategoryId,
  }
  if (Array.isArray(payload.assetIds)) {
    body.assetIds = payload.assetIds
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  }
  if (payload.fromCategoryId !== undefined) {
    body.fromCategoryId = payload.fromCategoryId
  }
  if (payload.includeDescendants !== undefined) {
    body.includeDescendants = payload.includeDescendants
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
    throw new Error(message || `移动资源失败（${response.status}）`)
  }

  const payloadBody = await parseJsonResponse<BulkMoveResourceAssetsResult>(response)
  if (!payloadBody || typeof payloadBody.modifiedCount !== 'number') {
    throw new Error('服务器返回的资源移动结果无效')
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

  const body = await parseJsonResponse<GenerateAssetTagResult>(response)
  if (!body || !Array.isArray(body.tags)) {
    throw new Error('AI 标签响应格式无效')
  }
  return {
    tags: body.tags.filter((tag): tag is string => typeof tag === 'string'),
    transcript: body.transcript ?? null,
    imagePrompt: body.imagePrompt ?? null,
    modelTraceId: body.modelTraceId,
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
}

export interface UploadAssetBundleOptions {
  bundleFile: File
}

export interface ResourceAssetHashLookupEntry {
  contentHash: string
  contentHashAlgorithm?: AssetBundleHashAlgorithm | null
}

export async function uploadAssetBundleToServer(options: UploadAssetBundleOptions): Promise<AssetBundleUploadResponse> {
  const url = buildServerApiUrl('/resources/asset-bundles')
  const formData = new FormData()
  const bundleName = options.bundleFile.name && options.bundleFile.name.trim().length ? options.bundleFile.name : 'asset-bundle.zip'
  formData.append('bundle', options.bundleFile, bundleName)

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
    throw new Error(message || `上传资源包失败（${response.status}）`)
  }

  const payload = await parseJsonResponse<AssetBundleUploadResponse>(response)
  if (!payload?.asset || !Array.isArray(payload.importedAssets) || !payload.assetIdMap || typeof payload.assetIdMap !== 'object') {
    throw new Error('服务器返回的资源包数据无效')
  }
  return payload
}

export async function uploadAssetToServer(options: UploadAssetOptions): Promise<ServerAssetDto> {
  const url = buildServerApiUrl('/resources/assets')
  if (typeof options.categoryId !== 'string' || !options.categoryId.trim().length) {
    throw new Error('请选择后台已维护的资源目录后再上传')
  }
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
  if (Array.isArray(options.categoryPathSegments) && !options.categoryId) {
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

export async function fetchResourceAsset(assetId: string): Promise<ServerAssetDto> {
  const trimmed = assetId.trim()
  if (!trimmed.length) {
    throw new Error('assetId 不能为空')
  }
  const url = buildServerApiUrl(`/resources/assets/${encodeURIComponent(trimmed)}`)
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
    throw buildError('获取资源失败', response)
  }
  const payload = await parseJsonResponse<ServerAssetDto>(response)
  if (!payload || typeof payload.id !== 'string') {
    throw new Error('服务器返回的资源数据无效')
  }
  return payload
}

export async function lookupResourceAssetsByHash(entries: ResourceAssetHashLookupEntry[]): Promise<AssetHashLookupResponse> {
  const normalizedEntries = entries
    .map((entry) => ({
      contentHash: typeof entry.contentHash === 'string' ? entry.contentHash.trim() : '',
      contentHashAlgorithm: typeof entry.contentHashAlgorithm === 'string' ? entry.contentHashAlgorithm : null,
    }))
    .filter((entry) => entry.contentHash.length > 0)

  if (!normalizedEntries.length) {
    return { matches: [] }
  }

  const url = buildServerApiUrl('/resources/assets/hash-lookup')
  const authStore = useAuthStore()
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
  })
  const authorization = authStore.authorizationHeader
  if (authorization) {
    headers.set('Authorization', authorization)
  }

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ entries: normalizedEntries }),
  })
  if (!response.ok) {
    throw buildError('按哈希查询资源失败', response)
  }
  const payload = await parseJsonResponse<AssetHashLookupResponse>(response)
  if (!payload || !Array.isArray(payload.matches)) {
    throw new Error('服务器返回的哈希查询结果无效')
  }
  return payload
}

export async function deleteResourceAsset(assetId: string): Promise<void> {
  const trimmed = assetId.trim()
  if (!trimmed.length) {
    throw new Error('assetId 不能为空')
  }
  const url = buildServerApiUrl(`/resources/assets/${encodeURIComponent(trimmed)}`)
  const authStore = useAuthStore()
  const headers = new Headers({ Accept: 'application/json' })
  const authorization = authStore.authorizationHeader
  if (authorization) {
    headers.set('Authorization', authorization)
  }

  const response = await fetch(url, {
    method: 'DELETE',
    credentials: 'include',
    headers,
  })
  if (!response.ok) {
    const errorBody = await parseJsonResponse<{ message?: string } | string | null>(response).catch(() => null)
    const message = typeof errorBody === 'string' ? errorBody : errorBody?.message
    throw new Error(message || `删除资源失败（${response.status}）`)
  }
}

export interface UpdateAssetFileOptions {
  assetId: string
  file?: File | null
  thumbnailFile?: File | null
  name?: string
  assetRole?: 'master' | 'dependant'
  description?: string | null
  type?: ProjectAsset['type']
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
}

export async function updateAssetOnServer(options: UpdateAssetFileOptions): Promise<ServerAssetDto> {
  const trimmed = options.assetId.trim()
  if (!trimmed.length) {
    throw new Error('assetId 不能为空')
  }
  const url = buildServerApiUrl(`/resources/assets/${encodeURIComponent(trimmed)}`)
  const formData = new FormData()
  if (options.file) {
    formData.append('file', options.file)
  }
  if (options.thumbnailFile) {
    const thumbnailName = options.thumbnailFile.name && options.thumbnailFile.name.trim().length ? options.thumbnailFile.name : 'thumbnail.png'
    formData.append('thumbnail', options.thumbnailFile, thumbnailName)
  }
  if (typeof options.name === 'string') {
    formData.append('name', options.name)
  }
  if (options.assetRole === 'master' || options.assetRole === 'dependant') {
    formData.append('assetRole', options.assetRole)
  }
  if (options.type) {
    formData.append('type', options.type)
  }
  if (options.description !== undefined) {
    formData.append('description', options.description ?? '')
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
    method: 'PUT',
    credentials: 'include',
    headers,
    body: formData,
  })
  if (!response.ok) {
    const errorBody = await parseJsonResponse<{ message?: string } | string | null>(response).catch(() => null)
    const message = typeof errorBody === 'string' ? errorBody : errorBody?.message
    throw new Error(message || `更新资源失败（${response.status}）`)
  }

  const payload = await parseJsonResponse<ServerAssetDto>(response)
  if (!payload || typeof payload.id !== 'string') {
    throw new Error('服务器返回的资源数据无效')
  }
  return payload
}

export { mapServerAssetToProjectAsset }
