import { AssetTypes, DEFAULT_ASSET_TYPE, isAssetType } from '@harmony/schema'
import type { AssetType } from '@harmony/schema'
import { TerrainScatterCategories } from '@harmony/schema/terrain-scatter'
import type { TerrainScatterCategory } from '@harmony/schema/terrain-scatter'
import type {
  AssetCategory as AssetCategoryDto,
  AssetDirectory,
  AssetManifest as AssetManifestDto,
  AssetManifestEntry as AssetManifestEntryDto,
  AssetSeries,
  AssetSummary,
  AssetTag,
  AssetTagSummary,
} from '@harmony/schema/asset-api'
import type { Context } from 'koa'
import path from 'node:path'
import fs from 'fs-extra'
import { nanoid } from 'nanoid'
import { Types } from 'mongoose'
import type { AssetCategoryDocument, AssetDocument, AssetSeriesDocument, AssetTagDocument } from '@/types/models'
import { AssetCategoryModel, normalizeCategoryName as normalizeCategoryLabel } from '@/models/AssetCategory'
import { AssetModel } from '@/models/Asset'
import { AssetTagModel } from '@/models/AssetTag'
import { AssetSeriesModel } from '@/models/AssetSeries'
import type { CategoryNodeDto, CategoryPathItemDto, CategoryTreeNode } from '@/services/assetCategoryService'
import {
  bulkMoveAssetsToCategory,
  deleteCategoryStrict,
  ensureCategoryConsistency,
  ensureRootCategory,
  ensureCategoryPath,
  getRootCategory,
  getCategoryPathItems,
  getCategoryTree,
  listCategoryChildren as listCategoryChildrenService,
  listDescendantCategoryIds,
  mergeCategories,
  moveCategory,
  sanitizeCategorySegments,
  searchCategories,
  updateCategoryInfo,
} from '@/services/assetCategoryService'
import { appConfig } from '@/config/env'
const MANIFEST_FILENAME = 'asset-manifest.json'
const THUMBNAIL_PREFIX = 'thumb-'

const ASSET_COLORS: Record<string, string> = {
  model: '#26c6da',
  image: '#1e88e5',
  texture: '#8e24aa',
  material: '#ffb74d',
  prefab: '#7986cb',
  video: '#ff7043',
  mesh: '#26c6da',
  file: '#6d4c41',
}

type UploadedFile = {
  filepath: string
  originalFilename?: string | null
  newFilename?: string | null
  mimetype?: string | null
  size?: number
}

type LeanAsset = AssetDocument & {
  tags?: AssetTagDocument[]
  seriesId?: AssetSeriesDocument | Types.ObjectId | null
}

type AssetCategoryData = {
  _id: Types.ObjectId
  name: AssetCategoryDocument['name']
  description?: AssetCategoryDocument['description']
  parentId?: Types.ObjectId | null
  depth: number
  pathIds: Types.ObjectId[]
  pathNames: string[]
  createdAt: Date
  updatedAt: Date
}

type AssetData = {
  _id: Types.ObjectId
  name: AssetDocument['name']
  categoryId: Types.ObjectId
  type: AssetDocument['type']
  tags: Types.ObjectId[] | AssetTagDocument[]
  size: number
  color?: string | null
  dimensionLength?: number | null
  dimensionWidth?: number | null
  dimensionHeight?: number | null
  sizeCategory?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  url: string
  fileKey: string
  previewUrl?: string | null
  thumbnailUrl?: string | null
  description?: string | null
  originalFilename?: string | null
  mimeType?: string | null
  metadata?: Record<string, unknown>
  terrainScatterPreset?: TerrainScatterCategory | null
  createdAt: Date
  updatedAt: Date
}

type AssetSource = LeanAsset | AssetData

type AssetListQuery = {
  page: number
  pageSize: number
  keyword?: string
  types?: AssetDocument['type'][]
  tagIds?: string[]
  seriesId?: string | null
  categoryId?: string
  categoryPath?: string[]
  includeDescendants?: boolean
}

type AssetMutationPayload = {
  name?: string
  type?: string
  description?: string | null
  tagIds?: string[]
  categoryId?: string | null
  seriesId?: string | null
  categoryPathSegments?: string[]
  color?: string | null
  dimensionLength?: number | null
  dimensionWidth?: number | null
  dimensionHeight?: number | null
  imageWidth?: number | null
  imageHeight?: number | null
  terrainScatterPreset?: TerrainScatterCategory | null
}

type ProjectDirectoryAsset = {
  id: string
  name: string
  type: AssetType
  downloadUrl: string
  previewColor: string
  thumbnail: string | null
  description: string | null
  gleaned: boolean
  color?: string | null
  dimensionLength?: number | null
  dimensionWidth?: number | null
  dimensionHeight?: number | null
  sizeCategory?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  terrainScatterPreset?: TerrainScatterCategory | null
}

type ProjectDirectory = AssetDirectory<ProjectDirectoryAsset> & {
  type: AssetType
}

function ensureArrayString(input: unknown): string[] {
  if (!input) {
    return []
  }
  if (Array.isArray(input)) {
    return input
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value): value is string => value.length > 0)
  }
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as unknown
      return ensureArrayString(parsed)
    } catch {
      return input
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    }
  }
  return []
}

function normalizeCategoryPathSegments(segments: string[] | undefined | null): string[] {
  if (!segments || !segments.length) {
    return []
  }
  const normalized = segments
    .map((segment) => (typeof segment === 'string' ? segment.trim() : ''))
    .filter((segment) => segment.length > 0)
  if (!normalized.length) {
    return []
  }
  const first = normalized[0]?.toLowerCase()
  if (first && (first === '全部' || first === 'all' || first === 'root')) {
    normalized.shift()
  }
  return normalized
}

async function findCategoryByPath(segments: string[]): Promise<AssetCategoryDocument | null> {
  const normalized = normalizeCategoryPathSegments(segments)
  if (!normalized.length) {
    return null
  }
  const normalizedNames = normalized.map((segment) => normalizeCategoryLabel(segment))
  const depth = normalized.length - 1
  const candidates = await AssetCategoryModel.find({
    normalizedName: normalizedNames[normalizedNames.length - 1]!,
    depth,
  }).exec()
  for (const candidate of candidates) {
    if (candidate.pathNames.length !== normalized.length) {
      continue
    }
    const matches = candidate.pathNames.every((name, index) => normalizeCategoryLabel(name) === normalizedNames[index])
    if (matches) {
      return candidate
    }
  }
  return null
}

type CategoryInfo = {
  id: string
  name: string
  path: CategoryPathItemDto[]
  pathString: string
}

async function loadCategoryInfoMap(categoryIds: Array<Types.ObjectId | string>): Promise<Map<string, CategoryInfo>> {
  const uniqueIds = Array.from(
    new Set(
      categoryIds
        .map((id) => {
          if (id instanceof Types.ObjectId) {
            return id.toString()
          }
          if (typeof id === 'string' && Types.ObjectId.isValid(id)) {
            return id
          }
          return null
        })
        .filter((value): value is string => value !== null),
    ),
  )
  if (!uniqueIds.length) {
    return new Map()
  }
  const objectIds = uniqueIds.map((id) => new Types.ObjectId(id))
  const categories = (await AssetCategoryModel.find({ _id: { $in: objectIds } }).lean().exec()) as AssetCategoryData[]
  const map = new Map<string, CategoryInfo>()
  categories.forEach((category) => {
    const id = (category._id as Types.ObjectId).toString()
    const path = category.pathIds.map((value, index) => ({
      id: (value as Types.ObjectId).toString(),
      name: category.pathNames[index] ?? '',
    }))
    map.set(id, {
      id,
      name: category.name,
      path,
      pathString: path.map((item) => item.name).join('/') || category.name,
    })
  })
  return map
}

function categoryDocumentToTreeNode(category: AssetCategoryDocument, options: { hasChildren?: boolean } = {}): CategoryTreeNode {
  const createdAt =
    category.createdAt instanceof Date ? category.createdAt.toISOString() : new Date(category.createdAt).toISOString()
  const updatedAt =
    category.updatedAt instanceof Date ? category.updatedAt.toISOString() : new Date(category.updatedAt).toISOString()
  return {
    id: (category._id as Types.ObjectId).toString(),
    name: category.name,
    description: category.description ?? null,
    parentId: category.parentId ? (category.parentId as Types.ObjectId).toString() : null,
    depth: category.depth,
    pathIds: category.pathIds.map((value) => (value as Types.ObjectId).toString()),
    pathNames: [...category.pathNames],
    hasChildren: Boolean(options.hasChildren ?? false),
    createdAt,
    updatedAt,
    children: [],
  }
}

function categoryNodeToTreeNode(node: CategoryNodeDto): CategoryTreeNode {
  return {
    ...node,
    children: [],
  }
}

function mapCategoryTreeNode(node: CategoryTreeNode): AssetCategoryDto {
  const path = node.pathIds.map((id, index) => ({
    id,
    name: node.pathNames[index] ?? '',
  }))
  return {
    id: node.id,
    name: node.name,
    description: sanitizeString(node.description) ?? null,
    parentId: node.parentId ?? null,
    depth: node.depth,
    path,
    hasChildren: node.hasChildren,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    children: node.children.map(mapCategoryTreeNode),
  }
}

function sanitizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function sanitizeHexColor(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : null
  if (!raw) {
    return null
  }
  const normalized = raw.startsWith('#') ? raw : `#${raw}`
  if (/^#([0-9a-fA-F]{6})$/.test(normalized)) {
    return `#${normalized.slice(1).toLowerCase()}`
  }
  return null
}

function sanitizeNonNegativeNumber(value: unknown): number | null {
  const candidate = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  if (!Number.isFinite(candidate)) {
    return null
  }
  return candidate >= 0 ? candidate : null
}

function sanitizeNonNegativeInteger(value: unknown): number | null {
  const parsed = sanitizeNonNegativeNumber(value)
  if (parsed === null) {
    return null
  }
  const rounded = Math.round(parsed)
  return rounded >= 0 ? rounded : null
}

const TERRAIN_SCATTER_PRESET_SET = new Set<TerrainScatterCategory>(TerrainScatterCategories)

function sanitizeTerrainScatterPreset(value: unknown): TerrainScatterCategory | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim().toLowerCase()
  if (!normalized.length) {
    return null
  }
  return TERRAIN_SCATTER_PRESET_SET.has(normalized as TerrainScatterCategory)
    ? (normalized as TerrainScatterCategory)
    : null
}

function determineSizeCategory(
  length: number | null | undefined,
  width: number | null | undefined,
  height: number | null | undefined,
): string | null {
  const values = [length, width, height].filter((value): value is number => typeof value === 'number' && value > 0)
  if (!values.length) {
    return null
  }
  const max = Math.max(...values)
  if (max < 0.1) {
    return '微型'
  }
  if (max < 0.5) {
    return '小型'
  }
  if (max < 1) {
    return '普通'
  }
  if (max < 3) {
    return '中型'
  }
  if (max < 10) {
    return '大型'
  }
  if (max < 30) {
    return '巨型'
  }
  return '巨大型'
}

const ASSET_TYPE_ALIAS_MAP: Partial<Record<string, AssetType>> = {
  meshes: 'mesh',
  prefabs: 'prefab',
  videos: 'video',
}

function normalizeAssetType(input: unknown, fallback: AssetDocument['type'] = DEFAULT_ASSET_TYPE): AssetDocument['type'] {
  if (typeof input !== 'string') {
    return fallback
  }
  const normalized = input.trim().toLowerCase()
  const aliased = ASSET_TYPE_ALIAS_MAP[normalized]
  if (aliased) {
    return aliased
  }
  if (isAssetType(normalized)) {
    return normalized as AssetDocument['type']
  }
  return fallback
}

function resolveFileKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null
  }
  try {
    const parsed = new URL(url)
    const publicBase = new URL(appConfig.assetPublicUrl)
    if (parsed.origin === publicBase.origin && parsed.pathname.startsWith(publicBase.pathname)) {
      const relative = parsed.pathname.slice(publicBase.pathname.length)
      return relative.replace(/^\/+/, '') || null
    }
  } catch {
    if (url.startsWith('/')) {
      const prefix = appConfig.assetPublicUrl.startsWith('/') ? appConfig.assetPublicUrl : ''
      const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`
      if (url.startsWith(normalizedPrefix)) {
        return url.slice(normalizedPrefix.length)
      }
      return url.replace(/^\/+/, '') || null
    }
    const publicUrl = appConfig.assetPublicUrl.endsWith('/') ? appConfig.assetPublicUrl : `${appConfig.assetPublicUrl}/`
    if (url.startsWith(publicUrl)) {
      return url.slice(publicUrl.length) || null
    }
  }
  return null
}

async function ensureStorageDir(): Promise<void> {
  await fs.ensureDir(appConfig.assetStoragePath)
}

function buildPublicUrl(fileKey: string): string {
  const base = appConfig.assetPublicUrl.replace(/\/?$/, '')
  const normalizedKey = fileKey.replace(/^\/+/, '')
  return `${base}/${normalizedKey}`
}

async function storeUploadedFile(file: UploadedFile, options: { prefix?: string } = {}): Promise<{
  fileKey: string
  url: string
  size: number
  mimeType: string | null
  originalFilename: string | null
}> {
  const sourcePath = file.filepath
  if (!sourcePath) {
    throw new Error('Invalid upload payload')
  }
  await ensureStorageDir()
  const originalName = sanitizeString(file.originalFilename ?? file.newFilename)
  const extension = originalName ? path.extname(originalName) : ''
  const fileKey = `${options.prefix ?? ''}${nanoid(16)}${extension}`
  const targetPath = path.join(appConfig.assetStoragePath, fileKey)
  await fs.copy(sourcePath, targetPath)
  await fs.remove(sourcePath).catch(() => undefined)
  return {
    fileKey,
    url: buildPublicUrl(fileKey),
    size: typeof file.size === 'number' ? file.size : await fs.stat(targetPath).then((stats) => stats.size),
    mimeType: sanitizeString(file.mimetype),
    originalFilename: originalName,
  }
}

async function deleteStoredFile(fileKey: string | null | undefined): Promise<void> {
  if (!fileKey) {
    return
  }
  const resolvedPath = path.join(appConfig.assetStoragePath, fileKey)
  if (resolvedPath.startsWith(appConfig.assetStoragePath) && (await fs.pathExists(resolvedPath))) {
    await fs.remove(resolvedPath).catch(() => undefined)
  }
}

let defaultCategoryInitialization: Promise<void> | null = null

async function ensureDefaultCategories(): Promise<void> {
  if (!defaultCategoryInitialization) {
    defaultCategoryInitialization = (async () => {
      await ensureRootCategory()
      await ensureCategoryConsistency()
    })().catch((error) => {
      defaultCategoryInitialization = null
      throw error
    })
  }
  await defaultCategoryInitialization
}

function isInvalidCategoryId(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.length > 0 && !Types.ObjectId.isValid(value)
}

async function resolveCategoryForPayload(
  type: AssetDocument['type'],
  payload: AssetMutationPayload,
): Promise<AssetCategoryDocument> {
  await ensureDefaultCategories()

  if (payload.categoryId) {
    if (isInvalidCategoryId(payload.categoryId)) {
      throw Object.assign(new Error('Invalid category identifier'), { code: 'INVALID_CATEGORY_ID' })
    }
    const category = await AssetCategoryModel.findById(payload.categoryId).exec()
    if (!category) {
      throw Object.assign(new Error('Category not found'), { code: 'CATEGORY_NOT_FOUND' })
    }
    return category
  }

  const normalizedSegments = normalizeCategoryPathSegments(payload.categoryPathSegments)
  if (normalizedSegments.length) {
    return ensureCategoryPath(normalizedSegments)
  }
  const rootCategory = (await getRootCategory()) ?? (await ensureRootCategory())
  return rootCategory
}

async function resolveSeriesObjectId(input: string | null | undefined): Promise<Types.ObjectId | null> {
  if (input === undefined) {
    return null
  }
  if (input === null) {
    return null
  }
  if (!Types.ObjectId.isValid(input)) {
    throw Object.assign(new Error('Invalid series identifier'), { code: 'INVALID_SERIES_ID' })
  }
  const series = await AssetSeriesModel.findById(input).select('_id').lean().exec()
  if (!series) {
    throw Object.assign(new Error('Series not found'), { code: 'SERIES_NOT_FOUND' })
  }
  return series._id as Types.ObjectId
}

function mapTagDocument(tag: AssetTagDocument | Types.ObjectId): AssetTagSummary | null {
  if (tag instanceof Types.ObjectId) {
    return { id: tag.toString(), name: tag.toString() }
  }
  if (!tag) {
    return null
  }
  const id = (tag._id as Types.ObjectId).toString()
  return { id, name: tag.name }
}

type SeriesDocumentLike = Pick<AssetSeriesDocument, '_id' | 'name' | 'description' | 'createdAt' | 'updatedAt'>

function mapSeriesDocument(series: SeriesDocumentLike, assetCount?: number): AssetSeries {
  const id = (series._id as Types.ObjectId).toString()
  const description = sanitizeString(series.description)
  const createdAt =
    series.createdAt instanceof Date
      ? series.createdAt.toISOString()
      : new Date(series.createdAt).toISOString()
  const updatedAt =
    series.updatedAt instanceof Date
      ? series.updatedAt.toISOString()
      : new Date(series.updatedAt).toISOString()
  return {
    id,
    name: series.name,
    description,
    assetCount,
    createdAt,
    updatedAt,
  }
}

function mapAssetDocument(asset: AssetSource, categoryLookup?: Map<string, CategoryInfo>): AssetSummary {
  const assetId = (asset._id as Types.ObjectId).toString()
  const categoryObjectId = (asset.categoryId as Types.ObjectId).toString()
  const categoryInfo = categoryLookup?.get(categoryObjectId) ?? null
  const categoryPath = categoryInfo?.path ?? []
  const categoryPathString = categoryInfo?.pathString ?? categoryPath.map((item) => item.name).join('/')
  const tagsRaw = Array.isArray(asset.tags) ? asset.tags : []
  const tags = tagsRaw
    .map((tag) => mapTagDocument(tag as AssetTagDocument | Types.ObjectId))
    .filter((tag): tag is AssetTagSummary => !!tag)

  const previewUrl = asset.previewUrl ?? asset.thumbnailUrl ?? null

  const rawSeries = (asset as AssetDocument & { seriesId?: unknown }).seriesId
  let seriesId: string | null = null
  let seriesName: string | null = null
  let seriesPayload: AssetSeries | null = null

  if (rawSeries instanceof Types.ObjectId) {
    seriesId = rawSeries.toString()
  } else if (typeof rawSeries === 'string') {
    seriesId = rawSeries
  } else if (rawSeries && typeof rawSeries === 'object' && '_id' in rawSeries) {
    const seriesDoc = rawSeries as SeriesDocumentLike
    seriesPayload = mapSeriesDocument(seriesDoc)
    seriesId = seriesPayload.id
    seriesName = seriesPayload.name
  }
  if (!seriesName && rawSeries && typeof rawSeries === 'object' && 'name' in rawSeries) {
    const name = (rawSeries as { name?: string }).name
    if (typeof name === 'string') {
      seriesName = name
    }
  }

  const color = sanitizeHexColor(asset.color)
  const dimensionLength = typeof asset.dimensionLength === 'number' ? asset.dimensionLength : null
  const dimensionWidth = typeof asset.dimensionWidth === 'number' ? asset.dimensionWidth : null
  const dimensionHeight = typeof asset.dimensionHeight === 'number' ? asset.dimensionHeight : null
  const sizeCategory = sanitizeString(asset.sizeCategory)
  const imageWidth = typeof asset.imageWidth === 'number' ? Math.round(asset.imageWidth) : null
  const imageHeight = typeof asset.imageHeight === 'number' ? Math.round(asset.imageHeight) : null
  const terrainScatterPreset = sanitizeTerrainScatterPreset((asset as AssetDocument).terrainScatterPreset)

  const description = sanitizeString(asset.description) ?? null
  const originalFilename = sanitizeString(asset.originalFilename)
  const mimeType = sanitizeString(asset.mimeType)

  const createdAt =
    asset.createdAt instanceof Date ? asset.createdAt.toISOString() : new Date(asset.createdAt).toISOString()
  const updatedAt =
    asset.updatedAt instanceof Date ? asset.updatedAt.toISOString() : new Date(asset.updatedAt).toISOString()

  return {
    id: assetId,
    name: asset.name,
    categoryId: categoryObjectId,
    categoryPath,
    categoryPathString,
    type: asset.type,
    tags,
    tagIds: tags.map((tag) => tag.id),
  seriesId,
  seriesName,
  series: seriesPayload,
  terrainScatterPreset: terrainScatterPreset ?? null,
    color,
    dimensionLength,
    dimensionWidth,
    dimensionHeight,
    sizeCategory: sizeCategory ?? null,
    imageWidth,
    imageHeight,
    size: asset.size ?? 0,
    url: asset.url,
    downloadUrl: asset.url,
    previewUrl,
    thumbnailUrl: asset.thumbnailUrl ?? previewUrl,
    description,
    originalFilename,
    mimeType,
    createdAt,
    updatedAt,
  }
}

type AssetTagDocumentLike = Pick<AssetTagDocument, '_id' | 'name' | 'description' | 'createdAt' | 'updatedAt'>

function mapAssetTagDocument(tag: AssetTagDocumentLike): AssetTag {
  const id = (tag._id as unknown as Types.ObjectId).toString()
  const description = sanitizeString(tag.description)
  const createdAt = tag.createdAt instanceof Date ? tag.createdAt.toISOString() : new Date(tag.createdAt).toISOString()
  const updatedAt = tag.updatedAt instanceof Date ? tag.updatedAt.toISOString() : new Date(tag.updatedAt).toISOString()
  return {
    id,
    name: tag.name,
    description,
    createdAt,
    updatedAt,
  }
}

function mapManifestEntry(asset: AssetSource, categoryLookup?: Map<string, CategoryInfo>): AssetManifestEntryDto {
  const response = mapAssetDocument(asset, categoryLookup)
  return {
    id: response.id,
    name: response.name,
    type: response.type,
    categoryId: response.categoryId,
    categoryPath: response.categoryPath,
    categoryPathString: response.categoryPathString,
    tags: response.tags ?? [],
    tagIds: response.tagIds,
    seriesId: response.seriesId ?? null,
    seriesName: response.seriesName ?? null,
    series: response.series ?? null,
    terrainScatterPreset: response.terrainScatterPreset ?? null,
    color: response.color ?? null,
    dimensionLength: response.dimensionLength ?? null,
    dimensionWidth: response.dimensionWidth ?? null,
    dimensionHeight: response.dimensionHeight ?? null,
    sizeCategory: response.sizeCategory ?? null,
    imageWidth: response.imageWidth ?? null,
    imageHeight: response.imageHeight ?? null,
    downloadUrl: response.downloadUrl,
    thumbnailUrl: response.thumbnailUrl ?? null,
    description: response.description ?? null,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
    size: response.size,
  }
}

async function readManifestFromDisk(): Promise<AssetManifestDto | null> {
  const manifestPath = path.join(appConfig.assetStoragePath, MANIFEST_FILENAME)
  if (!(await fs.pathExists(manifestPath))) {
    return null
  }
  try {
    const content = await fs.readFile(manifestPath, 'utf-8')
      return JSON.parse(content) as AssetManifestDto
  } catch (error) {
    console.warn('Failed to read asset manifest from disk', error)
    return null
  }
}

async function writeManifestToDisk(manifest: AssetManifestDto): Promise<void> {
  await ensureStorageDir()
  const manifestPath = path.join(appConfig.assetStoragePath, MANIFEST_FILENAME)
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
}

async function buildManifest(): Promise<AssetManifestDto> {
  const assets = (await AssetModel.find()
    .sort({ updatedAt: -1 })
    .populate('tags')
    .populate('seriesId')
    .lean()
    .exec()) as LeanAsset[]
  const categoryLookup = await loadCategoryInfoMap(assets.map((asset) => asset.categoryId as Types.ObjectId))
  const entries = assets.map((asset) => mapManifestEntry(asset, categoryLookup))
  return {
    generatedAt: new Date().toISOString(),
    assets: entries,
  }
}

function extractUploadedFile(files: Record<string, unknown> | undefined, field: string): UploadedFile | null {
  if (!files) {
    return null
  }
  const raw = files[field]
  const payload = Array.isArray(raw) ? raw[0] : raw
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const file = payload as UploadedFile & { path?: string }
  const filepath = file.filepath ?? file.path
  if (!filepath) {
    return null
  }
  return {
    filepath,
    originalFilename: file.originalFilename ?? file.newFilename ?? null,
    newFilename: file.newFilename ?? null,
    mimetype: file.mimetype ?? null,
    size: file.size,
  }
}

function resolveAssetFileKey(asset: AssetDocument | AssetData): string | null {
  if (typeof asset.fileKey === 'string' && asset.fileKey.trim().length) {
    return asset.fileKey
  }
  return resolveFileKeyFromUrl(asset.url)
}

function resolveThumbnailFileKey(asset: AssetDocument | AssetData): string | null {
  return resolveFileKeyFromUrl(asset.thumbnailUrl ?? asset.previewUrl ?? null)
}

async function buildAssetFilter(query: AssetListQuery): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = {}
  if (query.keyword) {
    filter.name = new RegExp(query.keyword, 'i')
  }
  if (query.types && query.types.length) {
    filter.type = { $in: query.types }
  }
  if (query.tagIds && query.tagIds.length) {
    const validTagIds = query.tagIds.filter((id) => Types.ObjectId.isValid(id))
    if (validTagIds.length) {
      filter.tags = { $all: validTagIds }
    }
  }
  if (query.seriesId !== undefined) {
    const rawSeriesId = query.seriesId
    if (rawSeriesId === null || rawSeriesId === 'none') {
      filter.seriesId = null
    } else if (rawSeriesId) {
      if (!Types.ObjectId.isValid(rawSeriesId)) {
        throw Object.assign(new Error('Invalid series identifier'), { code: 'INVALID_SERIES_ID' })
      }
  const exists = await AssetSeriesModel.exists({ _id: rawSeriesId }).exec()
      if (!exists) {
        filter.seriesId = { $in: [] }
      } else {
        filter.seriesId = new Types.ObjectId(rawSeriesId)
      }
    }
  }
  const includeDescendants = query.includeDescendants !== false
  const normalizedPath = normalizeCategoryPathSegments(query.categoryPath)
  if (normalizedPath.length) {
    const matched = await findCategoryByPath(normalizedPath)
    if (!matched) {
      filter.categoryId = { $in: [] }
    } else {
      const categoryIds = includeDescendants
        ? await listDescendantCategoryIds((matched._id as Types.ObjectId).toString())
        : [(matched._id as Types.ObjectId).toString()]
      filter.categoryId = {
        $in: categoryIds.map((id) => new Types.ObjectId(id)),
      }
    }
  } else if (query.categoryId) {
    if (isInvalidCategoryId(query.categoryId)) {
      throw Object.assign(new Error('Invalid category identifier'), { code: 'INVALID_CATEGORY_ID' })
    }
    const categoryExists = await AssetCategoryModel.exists({ _id: query.categoryId }).exec()
    if (!categoryExists) {
      filter.categoryId = { $in: [] }
    } else {
      const categoryIds = includeDescendants
        ? await listDescendantCategoryIds(query.categoryId)
        : [query.categoryId]
      filter.categoryId = {
        $in: categoryIds.map((id) => new Types.ObjectId(id)),
      }
    }
  }
  return filter
}

async function refreshManifest(): Promise<AssetManifestDto> {
  const manifest = await buildManifest()
  await writeManifestToDisk(manifest)
  return manifest
}

function extractMutationPayload(ctx: Context): AssetMutationPayload {
  const rawBody = ctx.request.body as Record<string, unknown> | undefined
  if (!rawBody) {
    return {}
  }
  const tagIds = ensureArrayString(rawBody.tagIds ?? rawBody.tags)
  const payload: AssetMutationPayload = {
    name: sanitizeString(rawBody.name) ?? undefined,
    type: sanitizeString(rawBody.type) ?? undefined,
    description: sanitizeString(rawBody.description),
    tagIds: tagIds.length ? tagIds : undefined,
    categoryId: sanitizeString(rawBody.categoryId),
  }
  const hasOwn = Object.prototype.hasOwnProperty.bind(rawBody)

  const rawSeriesInput = hasOwn('seriesId') ? rawBody.seriesId : hasOwn('series') ? rawBody.series : undefined
  if (hasOwn('seriesId') || hasOwn('series')) {
    if (rawSeriesInput === null) {
      payload.seriesId = null
    } else if (Array.isArray(rawSeriesInput)) {
      const first = sanitizeString(rawSeriesInput[0])
      if (!first || first.toLowerCase() === 'null' || first.toLowerCase() === 'none') {
        payload.seriesId = null
      } else {
        payload.seriesId = first
      }
    } else if (typeof rawSeriesInput === 'string') {
      const trimmed = sanitizeString(rawSeriesInput)
      if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'none') {
        payload.seriesId = null
      } else {
        payload.seriesId = trimmed
      }
    } else {
      payload.seriesId = null
    }
  }

  const rawCategorySegments = sanitizeCategorySegments(
    rawBody.categoryPath ?? rawBody.categoryPathSegments ?? rawBody.categoryNames ?? rawBody.categoryPathString,
  )
  const normalizedSegments = normalizeCategoryPathSegments(rawCategorySegments)
  if (normalizedSegments.length) {
    payload.categoryPathSegments = normalizedSegments
  }


  if (hasOwn('color')) {
    payload.color = sanitizeHexColor(rawBody.color)
  } else if (hasOwn('primaryColor')) {
    payload.color = sanitizeHexColor(rawBody.primaryColor)
  }

  if (hasOwn('dimensionLength')) {
    payload.dimensionLength = sanitizeNonNegativeNumber(rawBody.dimensionLength)
  } else if (hasOwn('length')) {
    payload.dimensionLength = sanitizeNonNegativeNumber(rawBody.length)
  }

  if (hasOwn('dimensionWidth')) {
    payload.dimensionWidth = sanitizeNonNegativeNumber(rawBody.dimensionWidth)
  } else if (hasOwn('width')) {
    payload.dimensionWidth = sanitizeNonNegativeNumber(rawBody.width)
  }

  if (hasOwn('dimensionHeight')) {
    payload.dimensionHeight = sanitizeNonNegativeNumber(rawBody.dimensionHeight)
  } else if (hasOwn('height')) {
    payload.dimensionHeight = sanitizeNonNegativeNumber(rawBody.height)
  }

  if (hasOwn('imageWidth')) {
    payload.imageWidth = sanitizeNonNegativeInteger(rawBody.imageWidth)
  }
  if (hasOwn('imageHeight')) {
    payload.imageHeight = sanitizeNonNegativeInteger(rawBody.imageHeight)
  }

  if (hasOwn('terrainScatterPreset')) {
    const preset = sanitizeTerrainScatterPreset(rawBody.terrainScatterPreset)
    if (preset) {
      payload.terrainScatterPreset = preset
    } else if (
      rawBody.terrainScatterPreset === null ||
      (typeof rawBody.terrainScatterPreset === 'string' &&
        (rawBody.terrainScatterPreset.trim().length === 0 ||
          ['none', 'null', 'unset'].includes(rawBody.terrainScatterPreset.trim().toLowerCase())))
    ) {
      payload.terrainScatterPreset = null
    } else {
      payload.terrainScatterPreset = null
    }
  }


  return payload
}

function parsePagination(query: Record<string, string | string[] | undefined>): AssetListQuery {
  const page = Number(Array.isArray(query.page) ? query.page[0] : query.page) || 1
  const pageSize = Number(Array.isArray(query.pageSize) ? query.pageSize[0] : query.pageSize) || 20
  const keyword = sanitizeString(Array.isArray(query.keyword) ? query.keyword[0] : query.keyword) ?? undefined
  const typesRaw = ensureArrayString(query.type ?? query.types)
  const validTypes = typesRaw
    .map((type) => normalizeAssetType(type))
    .filter((type, index, self) => self.indexOf(type) === index)
  const tagIds = ensureArrayString(query.tagIds ?? query.tagId)
  const rawSeriesParam = Array.isArray(query.seriesId)
    ? query.seriesId[0]
    : query.seriesId !== undefined
      ? query.seriesId
      : Array.isArray(query.series)
        ? query.series[0]
        : query.series
  let seriesId: string | null | undefined
  if (rawSeriesParam !== undefined) {
    const normalized = sanitizeString(rawSeriesParam)
    if (!normalized || normalized.toLowerCase() === 'all') {
      seriesId = undefined
    } else if (normalized.toLowerCase() === 'none' || normalized.toLowerCase() === 'null' || normalized.toLowerCase() === 'unassigned') {
      seriesId = 'none'
    } else {
      seriesId = normalized
    }
  }
  const categoryId = sanitizeString(Array.isArray(query.categoryId) ? query.categoryId[0] : query.categoryId)
  const rawCategoryPath = sanitizeCategorySegments(query.categoryPath ?? query.categoryPathSegments)
  const categoryPath = normalizeCategoryPathSegments(rawCategoryPath)
  const includeDescendantsRaw = Array.isArray(query.includeDescendants)
    ? query.includeDescendants[0]
    : query.includeDescendants
  const includeDescendants = includeDescendantsRaw === undefined ? true : includeDescendantsRaw !== 'false'
  return {
    page: page > 0 ? page : 1,
    pageSize: pageSize > 0 ? pageSize : 20,
    keyword,
    types: validTypes.length ? validTypes : undefined,
    tagIds: tagIds.length ? tagIds : undefined,
  seriesId,
    categoryId: categoryId ?? undefined,
    categoryPath: categoryPath.length ? categoryPath : undefined,
    includeDescendants,
  }
}

function mapDirectory(categories: AssetCategoryData[], assets: AssetData[]): ProjectDirectory[] {
  return categories.map((category) => {
    const categoryAssets = assets
      .filter((asset) => asset.categoryId.toString() === category._id.toString())
      .map((asset): ProjectDirectoryAsset => {
        const description = sanitizeString(asset.description)
        const thumbnail = asset.thumbnailUrl ?? asset.previewUrl ?? null
        return {
          id: asset._id.toString(),
          name: asset.name,
          type: asset.type,
          downloadUrl: asset.url,
          previewColor: ASSET_COLORS[asset.type] ?? '#546e7a',
          thumbnail,
          description,
          gleaned: false,
          color: sanitizeHexColor(asset.color),
          dimensionLength: typeof asset.dimensionLength === 'number' ? asset.dimensionLength : null,
          dimensionWidth: typeof asset.dimensionWidth === 'number' ? asset.dimensionWidth : null,
          dimensionHeight: typeof asset.dimensionHeight === 'number' ? asset.dimensionHeight : null,
          sizeCategory: sanitizeString(asset.sizeCategory) ?? null,
          imageWidth: typeof asset.imageWidth === 'number' ? Math.round(asset.imageWidth) : null,
          imageHeight: typeof asset.imageHeight === 'number' ? Math.round(asset.imageHeight) : null,
          terrainScatterPreset: sanitizeTerrainScatterPreset(asset.terrainScatterPreset) ?? null,
        }
      })

    const directoryType: AssetType = categoryAssets.length ? categoryAssets[0]!.type : DEFAULT_ASSET_TYPE

    return {
      id: category._id.toString(),
      name: category.name,
      type: directoryType,
      assets: categoryAssets,
    }
  })
}

export async function listResourceCategories(ctx: Context): Promise<void> {
  await ensureDefaultCategories()
  const tree = await getCategoryTree()
  ctx.body = tree.map(mapCategoryTreeNode)
}

export async function createAssetCategory(ctx: Context): Promise<void> {
  await ensureDefaultCategories()
  const body = ctx.request.body as Record<string, unknown> | undefined
  const rawParentId = sanitizeString(body?.parentId)
  const parentId = rawParentId && rawParentId.toLowerCase() === 'root' ? null : rawParentId
  if (parentId && isInvalidCategoryId(parentId)) {
    ctx.throw(400, 'Invalid parent category id')
  }

  const description = sanitizeString(body?.description)
  const rawSegments = sanitizeCategorySegments(body?.path ?? body?.segments ?? body?.names ?? null)
  let segments = normalizeCategoryPathSegments(rawSegments)
  const name = sanitizeString(body?.name)
  if (name) {
    const normalizedName = normalizeCategoryLabel(name)
    if (!segments.length || normalizeCategoryLabel(segments[segments.length - 1]!) !== normalizedName) {
      segments = [...segments, name]
    }
  }

  if (!segments.length) {
    ctx.throw(400, 'Category name is required')
  }

  try {
    const category = await ensureCategoryPath(segments, { parentId, description })
    const node = categoryDocumentToTreeNode(category)
    ctx.status = 201
    ctx.body = mapCategoryTreeNode(node)
  } catch (error) {
    if (error instanceof Error) {
      const message = error.message
      if (message.includes('Invalid parent category id')) {
        ctx.throw(400, 'Invalid parent category id')
      }
      if (message.includes('Parent category not found')) {
        ctx.throw(404, 'Parent category not found')
      }
      if (message.includes('cannot be empty')) {
        ctx.throw(400, 'Category name is required')
      }
    }
    throw error
  }
}

export async function getAssetCategoryChildren(ctx: Context): Promise<void> {
  await ensureDefaultCategories()
  const { id } = ctx.params
  let parentId: string | null = null
  if (id && id !== 'root') {
    if (isInvalidCategoryId(id)) {
      ctx.throw(400, 'Invalid category id')
    }
    parentId = id
  }
  const children = await listCategoryChildrenService(parentId)
  ctx.body = children.map((node) => mapCategoryTreeNode(categoryNodeToTreeNode(node)))
}

export async function getAssetCategoryPath(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid category id')
  }
  const pathItems = await getCategoryPathItems(id)
  if (!pathItems.length) {
    const exists = await AssetCategoryModel.exists({ _id: id })
    if (!exists) {
      ctx.throw(404, 'Category not found')
    }
  }
  ctx.body = pathItems
}

export async function getAssetCategoryDescendants(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid category id')
  }
  const category = await AssetCategoryModel.findById(id).exec()
  if (!category) {
    ctx.throw(404, 'Category not found')
  }
  const descendants = await AssetCategoryModel.find({ pathIds: category._id })
    .sort({ depth: 1, name: 1 })
    .exec()
  const nodes = descendants.map((doc) => categoryDocumentToTreeNode(doc))
  const nodeMap = new Map<string, CategoryTreeNode>()
  nodes.forEach((node) => nodeMap.set(node.id, node))
  nodes.forEach((node) => {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId)!.children.push(node)
      nodeMap.get(node.parentId)!.hasChildren = true
    }
  })
  const rootNode = nodeMap.get((category._id as Types.ObjectId).toString())
  if (!rootNode) {
    ctx.throw(500, 'Failed to build category tree')
  }
  ctx.body = mapCategoryTreeNode(rootNode)
}

export async function listCategoryAssets(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid category id')
  }
  const query = parsePagination(ctx.query as Record<string, string | string[] | undefined>)
  query.categoryId = id
  const includeDescendantsRaw = Array.isArray(ctx.query.includeDescendants)
    ? ctx.query.includeDescendants[0]
    : ctx.query.includeDescendants
  query.includeDescendants = includeDescendantsRaw === undefined ? true : includeDescendantsRaw !== 'false'

  let filter: Record<string, unknown>
  try {
    filter = await buildAssetFilter(query)
  } catch (error) {
    if ((error as { code?: string } | null)?.code === 'INVALID_CATEGORY_ID') {
      ctx.throw(400, 'Invalid category identifier')
    }
    throw error
  }

  const skip = (query.page - 1) * query.pageSize
  const [assets, total] = await Promise.all([
    AssetModel.find(filter)
      .populate('tags')
      .populate('seriesId')
      .skip(skip)
      .limit(query.pageSize)
      .sort({ createdAt: -1 })
      .lean()
      .exec() as Promise<LeanAsset[]>,
    AssetModel.countDocuments(filter),
  ])

  const categoryLookup = await loadCategoryInfoMap(assets.map((asset) => asset.categoryId as Types.ObjectId))

  ctx.body = {
    data: assets.map((asset) => mapAssetDocument(asset, categoryLookup)),
    page: query.page,
    pageSize: query.pageSize,
    total,
  }
}

export async function updateAssetCategory(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid category id')
  }
  const body = ctx.request.body as Record<string, unknown> | undefined
  const name = sanitizeString(body?.name)
  const description = body?.description === undefined ? undefined : sanitizeString(body?.description)
  if (name === undefined && description === undefined) {
    ctx.throw(400, 'No category fields provided')
  }
  try {
    const updated = await updateCategoryInfo(id, {
      name: name ?? undefined,
      description,
    })
    const node = categoryDocumentToTreeNode(updated)
    ctx.body = mapCategoryTreeNode(node)
  } catch (error) {
    if (error instanceof Error && error.message.includes('已存在相同名称')) {
      ctx.throw(409, 'Category name already exists at this level')
    }
    throw error
  }
}

export async function deleteAssetCategory(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid category id')
  }
  try {
    await deleteCategoryStrict(id)
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('子类别')) {
        ctx.throw(409, 'Category has child categories and cannot be deleted')
      }
      if (error.message.includes('关联的资产')) {
        ctx.throw(409, 'Category still contains assets and cannot be deleted')
      }
    }
    throw error
  }
  // Return explicit body to avoid client-side JSON parse errors when receiving 204 No Content
  ctx.status = 200
  ctx.body = {}
}

export async function moveAssetCategory(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid category id')
  }
  const body = ctx.request.body as Record<string, unknown> | undefined
  const rawTargetParentId = sanitizeString(body?.targetParentId)
  const targetParentId = !rawTargetParentId || rawTargetParentId.toLowerCase() === 'null' ? null : rawTargetParentId
  if (targetParentId !== null && !Types.ObjectId.isValid(targetParentId)) {
    ctx.throw(400, 'Invalid target parent category id')
  }

  try {
    const moved = await moveCategory(id, targetParentId)
    await refreshManifest()
    const hasChildren =
      (await AssetCategoryModel.exists({ parentId: moved._id as Types.ObjectId }).select('_id').lean().exec()) !== null
    ctx.body = mapCategoryTreeNode(categoryDocumentToTreeNode(moved, { hasChildren }))
  } catch (error) {
    if (error instanceof Error) {
      const message = error.message
      if (message.includes('Invalid category id')) {
        ctx.throw(400, 'Invalid category id')
      }
      if (message.includes('Invalid target parent category id')) {
        ctx.throw(400, 'Invalid target parent category id')
      }
      if (message.includes('Category not found') || message.includes('Target parent category not found')) {
        ctx.throw(404, message.includes('Target') ? 'Target parent category not found' : 'Category not found')
      }
      if (message.includes('Root category cannot be moved')) {
        ctx.throw(409, 'Root category cannot be moved')
      }
      if (message.includes('Cannot move category')) {
        ctx.throw(409, message)
      }
      if (message.includes('Category name already exists at target level')) {
        ctx.throw(409, 'Category name already exists at target level')
      }
    }
    throw error
  }
}

export async function mergeAssetCategories(ctx: Context): Promise<void> {
  const body = ctx.request.body as Record<string, unknown> | undefined
  const sourceCategoryId = sanitizeString(body?.sourceCategoryId)
  const targetCategoryId = sanitizeString(body?.targetCategoryId)
  if (!sourceCategoryId || !Types.ObjectId.isValid(sourceCategoryId)) {
    ctx.throw(400, 'Invalid source category id')
  }
  if (!targetCategoryId || !Types.ObjectId.isValid(targetCategoryId)) {
    ctx.throw(400, 'Invalid target category id')
  }
  const rawMoveChildren = body?.moveChildren
  const moveChildren = typeof rawMoveChildren === 'boolean' ? rawMoveChildren : rawMoveChildren !== 'false'

  try {
    const result = await mergeCategories({
      sourceCategoryId,
      targetCategoryId,
      moveChildren,
    })
    await refreshManifest()
    ctx.body = result
  } catch (error) {
    if (error instanceof Error) {
      const message = error.message
      if (message.includes('Invalid category id')) {
        ctx.throw(400, 'Invalid category id')
      }
      if (message.includes('Source and target categories cannot be the same')) {
        ctx.throw(409, 'Source and target categories cannot be the same')
      }
      if (message.includes('Source category not found')) {
        ctx.throw(404, 'Source category not found')
      }
      if (message.includes('Target category not found')) {
        ctx.throw(404, 'Target category not found')
      }
      if (message.includes('Root category cannot be merged')) {
        ctx.throw(409, 'Root category cannot be merged')
      }
      if (message.includes('Cannot merge category into its own descendant')) {
        ctx.throw(409, 'Cannot merge category into its own descendant')
      }
      if (message.includes('Source category has child categories')) {
        ctx.throw(409, 'Source category has child categories')
      }
      if (message.includes('Child category name conflict')) {
        ctx.throw(409, message)
      }
    }
    throw error
  }
}

export async function bulkMoveAssetsCategory(ctx: Context): Promise<void> {
  const body = ctx.request.body as Record<string, unknown> | undefined
  const targetCategoryId = sanitizeString(body?.targetCategoryId)
  if (!targetCategoryId || !Types.ObjectId.isValid(targetCategoryId)) {
    ctx.throw(400, 'Invalid target category id')
  }

  const fromCategoryId = sanitizeString(body?.fromCategoryId)
  if (fromCategoryId && !Types.ObjectId.isValid(fromCategoryId)) {
    ctx.throw(400, 'Invalid source category id')
  }
  const includeDescendants =
    body?.includeDescendants === undefined
      ? true
      : body.includeDescendants === true ||
        (typeof body.includeDescendants === 'string' && body.includeDescendants !== 'false')

  const assetIds = ensureArrayString(body?.assetIds)
  if (!assetIds.length && !fromCategoryId) {
    ctx.throw(400, 'Either assetIds or fromCategoryId is required')
  }

  try {
    const result = await bulkMoveAssetsToCategory({
      assetIds: assetIds.length ? assetIds : undefined,
      fromCategoryId: fromCategoryId ?? undefined,
      includeDescendants,
      targetCategoryId,
    })
    if (result.modifiedCount > 0) {
      await refreshManifest()
    }
    ctx.body = result
  } catch (error) {
    if (error instanceof Error) {
      const message = error.message
      if (message.includes('Invalid target category id')) {
        ctx.throw(400, 'Invalid target category id')
      }
      if (message.includes('Invalid source category id')) {
        ctx.throw(400, 'Invalid source category id')
      }
      if (message.includes('Invalid asset id')) {
        ctx.throw(400, 'Invalid asset id')
      }
      if (message.includes('Target category not found')) {
        ctx.throw(404, 'Target category not found')
      }
      if (message.includes('Source category not found')) {
        ctx.throw(404, 'Source category not found')
      }
      if (message.includes('Either assetIds or fromCategoryId is required')) {
        ctx.throw(400, 'Either assetIds or fromCategoryId is required')
      }
    }
    throw error
  }
}

export async function searchAssetCategories(ctx: Context): Promise<void> {
  await ensureDefaultCategories()
  const keyword = sanitizeString(Array.isArray(ctx.query.keyword) ? ctx.query.keyword[0] : ctx.query.keyword) ?? ''
  const limitRaw = Array.isArray(ctx.query.limit) ? ctx.query.limit[0] : ctx.query.limit
  const limit = limitRaw ? Math.max(1, Math.min(Number(limitRaw) || 20, 100)) : 20
  if (!keyword.length) {
    ctx.body = []
    return
  }
  const results = await searchCategories(keyword, limit)
  ctx.body = results.map((node) => mapCategoryTreeNode(categoryNodeToTreeNode(node)))
}

export async function listAssets(ctx: Context): Promise<void> {
  const query = parsePagination(ctx.query as Record<string, string | string[] | undefined>)
  let filter: Record<string, unknown>
  try {
    filter = await buildAssetFilter(query)
  } catch (error) {
    if ((error as { code?: string } | null)?.code === 'INVALID_CATEGORY_ID') {
      ctx.throw(400, 'Invalid category identifier')
    }
    throw error
  }
  const skip = (query.page - 1) * query.pageSize

  const [assets, total] = await Promise.all([
    AssetModel.find(filter)
      .populate('tags')
      .skip(skip)
      .limit(query.pageSize)
      .sort({ createdAt: -1 })
      .lean()
      .exec() as Promise<LeanAsset[]>,
    AssetModel.countDocuments(filter),
  ])

  const categoryLookup = await loadCategoryInfoMap(assets.map((asset) => asset.categoryId as Types.ObjectId))

  ctx.body = {
    data: assets.map((asset) => mapAssetDocument(asset, categoryLookup)),
    page: query.page,
    pageSize: query.pageSize,
    total,
  }
}

export async function getAsset(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid asset id')
  }
  const asset = (await AssetModel.findById(id).populate('tags').populate('seriesId').lean().exec()) as LeanAsset | null
  if (!asset) {
    ctx.throw(404, 'Asset not found')
  }
  const categoryLookup = await loadCategoryInfoMap([asset.categoryId as Types.ObjectId])
  ctx.body = mapAssetDocument(asset, categoryLookup)
}

export async function uploadAsset(ctx: Context): Promise<void> {
  const files = ctx.request.files as Record<string, unknown> | undefined
  const file = extractUploadedFile(files, 'file')
  if (!file) {
    ctx.throw(400, 'Asset file is required')
  }

  const payload = extractMutationPayload(ctx)
  const type = normalizeAssetType(payload.type ?? 'file')
  const tagsRaw = payload.tagIds ?? []
  const tagObjectIds = tagsRaw
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id))

  if (tagObjectIds.length !== tagsRaw.length) {
    ctx.throw(400, 'Invalid tag ids provided')
  }

  if (tagObjectIds.length) {
    const count = await AssetTagModel.countDocuments({ _id: { $in: tagObjectIds } })
    if (count !== tagObjectIds.length) {
      ctx.throw(400, 'One or more tag ids do not exist')
    }
  }

  const fileInfo = await storeUploadedFile(file)
  const thumbnailFile = extractUploadedFile(files, 'thumbnail')
  let thumbnailInfo: Awaited<ReturnType<typeof storeUploadedFile>> | null = null
  if (thumbnailFile) {
    thumbnailInfo = await storeUploadedFile(thumbnailFile, { prefix: THUMBNAIL_PREFIX })
  }

  let categoryDoc: AssetCategoryDocument
  try {
    categoryDoc = await resolveCategoryForPayload(type, payload)
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === 'INVALID_CATEGORY_ID') {
      ctx.throw(400, 'Invalid category identifier')
    }
    if (code === 'CATEGORY_NOT_FOUND') {
      ctx.throw(404, 'Category not found')
    }
    throw error
  }

  const categoryId = categoryDoc._id as Types.ObjectId

  let seriesObjectId: Types.ObjectId | null = null
  try {
    seriesObjectId = await resolveSeriesObjectId(payload.seriesId)
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === 'INVALID_SERIES_ID') {
      ctx.throw(400, 'Invalid series identifier')
    }
    if (code === 'SERIES_NOT_FOUND') {
      ctx.throw(404, 'Series not found')
    }
    throw error
  }

  const dimensionLength = payload.dimensionLength ?? null
  const dimensionWidth = payload.dimensionWidth ?? null
  const dimensionHeight = payload.dimensionHeight ?? null
  const sizeCategory = determineSizeCategory(dimensionLength, dimensionWidth, dimensionHeight)
  const imageWidth = payload.imageWidth ?? null
  const imageHeight = payload.imageHeight ?? null
  const color = payload.color ?? null
  const terrainScatterPreset = payload.terrainScatterPreset ?? null

  const asset = await AssetModel.create({
    name: payload.name ?? fileInfo.originalFilename ?? fileInfo.fileKey,
    categoryId,
    type,
    tags: tagObjectIds,
  seriesId: seriesObjectId,
    size: fileInfo.size,
    color,
    dimensionLength,
    dimensionWidth,
    dimensionHeight,
    sizeCategory,
    imageWidth,
    imageHeight,
    url: fileInfo.url,
    fileKey: fileInfo.fileKey,
    previewUrl: thumbnailInfo?.url ?? (type === 'image' ? fileInfo.url : null),
    thumbnailUrl: thumbnailInfo?.url ?? (type === 'image' ? fileInfo.url : null),
    description: payload.description ?? null,
    originalFilename: fileInfo.originalFilename,
    mimeType: fileInfo.mimeType,
    terrainScatterPreset,
  })

  const populated = (await asset.populate([
    { path: 'tags' },
    { path: 'seriesId' },
  ])) as AssetDocument & { tags: AssetTagDocument[]; seriesId?: AssetSeriesDocument | null }
  const categoryLookup = await loadCategoryInfoMap([categoryId])
  const response = mapAssetDocument(populated, categoryLookup)
  await refreshManifest()
  ctx.body = { asset: response }
}

export async function updateAsset(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid asset id')
  }

  const asset = await AssetModel.findById(id)
  if (!asset) {
    ctx.throw(404, 'Asset not found')
  }

  const payload = extractMutationPayload(ctx)
  const files = ctx.request.files as Record<string, unknown> | undefined
  const file = extractUploadedFile(files, 'file')
  const thumbnailFile = extractUploadedFile(files, 'thumbnail')

  const updates: Partial<AssetDocument> & Record<string, unknown> = {}
  let nextType = asset.type

  if (payload.name) {
    updates.name = payload.name
  }
  if (payload.description !== undefined) {
    updates.description = payload.description
  }
  if (payload.color !== undefined) {
    updates.color = payload.color ?? null
  }
  if (payload.terrainScatterPreset !== undefined) {
    updates.terrainScatterPreset = payload.terrainScatterPreset ?? null
  }
  if (payload.tagIds) {
    const tagIds = payload.tagIds.filter((tagId) => Types.ObjectId.isValid(tagId))
    if (tagIds.length !== payload.tagIds.length) {
      ctx.throw(400, 'Invalid tag ids provided')
    }
    const count = await AssetTagModel.countDocuments({ _id: { $in: tagIds } })
    if (count !== tagIds.length) {
      ctx.throw(400, 'One or more tag ids do not exist')
    }
    updates.tags = tagIds.map((tagId) => new Types.ObjectId(tagId))
  }
  if (payload.type) {
    const normalizedType = normalizeAssetType(payload.type, asset.type)
    if (normalizedType !== asset.type) {
      updates.type = normalizedType
      nextType = normalizedType
    }
  }

  if (payload.seriesId !== undefined) {
    try {
      updates.seriesId = await resolveSeriesObjectId(payload.seriesId)
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      if (code === 'INVALID_SERIES_ID') {
        ctx.throw(400, 'Invalid series identifier')
      }
      if (code === 'SERIES_NOT_FOUND') {
        ctx.throw(404, 'Series not found')
      }
      throw error
    }
  }

  const shouldResolveCategory =
    updates.type !== undefined ||
    Boolean(payload.categoryId && payload.categoryId.length) ||
    Boolean(payload.categoryPathSegments && payload.categoryPathSegments.length)

  if (shouldResolveCategory) {
    try {
      const resolvedCategoryDoc = await resolveCategoryForPayload(nextType, payload)
      updates.categoryId = resolvedCategoryDoc._id as Types.ObjectId
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      if (code === 'INVALID_CATEGORY_ID') {
        ctx.throw(400, 'Invalid category identifier')
      }
      if (code === 'CATEGORY_NOT_FOUND') {
        ctx.throw(404, 'Category not found')
      }
      throw error
    }
  }

  if (file) {
    const fileInfo = await storeUploadedFile(file)
    const previousFileKey = resolveAssetFileKey(asset)
    updates.url = fileInfo.url
    updates.fileKey = fileInfo.fileKey
    updates.size = fileInfo.size
    updates.originalFilename = fileInfo.originalFilename
    updates.mimeType = fileInfo.mimeType
    await deleteStoredFile(previousFileKey)
    if (!thumbnailFile && (updates.type ?? asset.type) === 'image') {
      updates.previewUrl = fileInfo.url
      updates.thumbnailUrl = fileInfo.url
    }
  }

  if (thumbnailFile) {
    const thumbnailInfo = await storeUploadedFile(thumbnailFile, { prefix: THUMBNAIL_PREFIX })
    const previousThumbnailKey = resolveThumbnailFileKey(asset)
    updates.previewUrl = thumbnailInfo.url
    updates.thumbnailUrl = thumbnailInfo.url
    await deleteStoredFile(previousThumbnailKey)
  }

  let nextDimensionLength = asset.dimensionLength ?? null
  if (payload.dimensionLength !== undefined) {
    nextDimensionLength = payload.dimensionLength ?? null
    updates.dimensionLength = nextDimensionLength
  }

  let nextDimensionWidth = asset.dimensionWidth ?? null
  if (payload.dimensionWidth !== undefined) {
    nextDimensionWidth = payload.dimensionWidth ?? null
    updates.dimensionWidth = nextDimensionWidth
  }

  let nextDimensionHeight = asset.dimensionHeight ?? null
  if (payload.dimensionHeight !== undefined) {
    nextDimensionHeight = payload.dimensionHeight ?? null
    updates.dimensionHeight = nextDimensionHeight
  }

  let nextImageWidth = asset.imageWidth ?? null
  if (payload.imageWidth !== undefined) {
    nextImageWidth = payload.imageWidth ?? null
    updates.imageWidth = nextImageWidth
  }

  let nextImageHeight = asset.imageHeight ?? null
  if (payload.imageHeight !== undefined) {
    nextImageHeight = payload.imageHeight ?? null
    updates.imageHeight = nextImageHeight
  }

  const currentSizeCategory = sanitizeString(asset.sizeCategory) ?? null
  const computedSizeCategory = determineSizeCategory(nextDimensionLength, nextDimensionWidth, nextDimensionHeight)
  if (computedSizeCategory !== currentSizeCategory) {
    updates.sizeCategory = computedSizeCategory
  }

  if (Object.keys(updates).length === 0) {
    const populated = (await asset.populate([
      { path: 'tags' },
      { path: 'seriesId' },
    ])) as AssetDocument & { tags: AssetTagDocument[]; seriesId?: AssetSeriesDocument | null }
    const categoryLookup = await loadCategoryInfoMap([populated.categoryId as Types.ObjectId])
    ctx.body = mapAssetDocument(populated, categoryLookup)
    return
  }

  await AssetModel.updateOne({ _id: id }, { $set: updates })
  const updated = (await AssetModel.findById(id).populate('tags').populate('seriesId').lean().exec()) as LeanAsset | null
  if (!updated) {
    ctx.throw(500, 'Failed to update asset')
  }
  await refreshManifest()
  const categoryLookup = await loadCategoryInfoMap([updated.categoryId as Types.ObjectId])
  ctx.body = mapAssetDocument(updated, categoryLookup)
}

export async function deleteAsset(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid asset id')
  }
  const asset = await AssetModel.findByIdAndDelete(id).lean().exec()
  if (asset) {
    const fileKey = resolveAssetFileKey(asset)
    const thumbnailKey = resolveThumbnailFileKey(asset)
    await deleteStoredFile(fileKey)
    if (thumbnailKey && thumbnailKey !== fileKey) {
      await deleteStoredFile(thumbnailKey)
    }
    await refreshManifest()
  }
  // Return explicit body to avoid client-side JSON parse errors when receiving 204 No Content
  ctx.status = 200
  ctx.body = {}
}

export async function downloadAsset(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid asset id')
  }
  const asset = await AssetModel.findById(id).lean().exec()
  if (!asset) {
    ctx.throw(404, 'Asset not found')
  }
  const fileKey = resolveAssetFileKey(asset)
  if (!fileKey) {
    ctx.throw(404, 'Asset file missing')
  }
  const filePath = path.join(appConfig.assetStoragePath, fileKey)
  if (!(await fs.pathExists(filePath))) {
    ctx.throw(404, 'Asset file not found')
  }
  ctx.set('Cache-Control', 'no-store')
  ctx.type = asset.mimeType ?? path.extname(asset.url) ?? 'application/octet-stream'
  ctx.attachment(asset.originalFilename ?? asset.name)
  ctx.body = fs.createReadStream(filePath)
}

export async function listAssetTags(ctx: Context): Promise<void> {
  const tags = (await AssetTagModel.find().sort({ name: 1 }).lean().exec()) as AssetTagDocument[]
  ctx.body = tags.map((tag) => mapAssetTagDocument(tag))
}

export async function listAssetSeries(ctx: Context): Promise<void> {
  const [seriesList, counts] = await Promise.all([
    AssetSeriesModel.find().sort({ name: 1 }).lean().exec() as Promise<AssetSeriesDocument[]>,
    AssetModel.aggregate([
      {
        $group: {
          _id: '$seriesId',
          count: { $sum: 1 },
        },
      },
    ]).exec() as Promise<Array<{ _id: Types.ObjectId | null; count: number }>>,
  ])

  const countLookup = new Map<string, number>()
  counts.forEach((entry) => {
    const key = entry._id ? (entry._id as Types.ObjectId).toString() : 'none'
    countLookup.set(key, entry.count ?? 0)
  })

  ctx.body = seriesList.map((series) => {
    const id = (series._id as Types.ObjectId).toString()
    return mapSeriesDocument(series, countLookup.get(id) ?? 0)
  })
}

export async function createAssetSeries(ctx: Context): Promise<void> {
  const body = ctx.request.body as Record<string, unknown> | undefined
  const name = sanitizeString(body?.name)
  if (!name) {
    ctx.throw(400, 'Series name is required')
  }
  const description = sanitizeString(body?.description)
  try {
    const created = await AssetSeriesModel.create({
      name,
      description: description ?? null,
    })
    const mapped = mapSeriesDocument(created.toObject() as SeriesDocumentLike, 0)
    ctx.status = 201
    ctx.body = mapped
  } catch (error) {
    if ((error as { code?: number } | null)?.code === 11000) {
      ctx.throw(409, 'Series name already exists')
    }
    throw error
  }
}

export async function updateAssetSeries(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid series id')
  }
  const body = ctx.request.body as Record<string, unknown> | undefined
  const name = sanitizeString(body?.name)
  if (!name) {
    ctx.throw(400, 'Series name is required')
  }
  const description = sanitizeString(body?.description)
  const duplicate = await AssetSeriesModel.findOne({ name, _id: { $ne: id } }).select('_id').lean().exec()
  if (duplicate) {
    ctx.throw(409, 'Series name already exists')
  }
  const updated = await AssetSeriesModel.findByIdAndUpdate(
    id,
    { name, description: description ?? null },
    { new: true },
  ).lean().exec()
  if (!updated) {
    ctx.throw(404, 'Series not found')
  }
  const count = await AssetModel.countDocuments({ seriesId: id }).exec()
  ctx.body = mapSeriesDocument(updated as SeriesDocumentLike, count)
}

export async function listSeriesAssets(ctx: Context): Promise<void> {
  const { id } = ctx.params
  const targetSeries = sanitizeString(id)
  if (!targetSeries) {
    ctx.throw(400, 'Series identifier is required')
  }
  if (targetSeries !== 'none' && !Types.ObjectId.isValid(targetSeries)) {
    ctx.throw(400, 'Invalid series identifier')
  }
  if (targetSeries !== 'none') {
    const exists = await AssetSeriesModel.exists({ _id: targetSeries }).exec()
    if (!exists) {
      ctx.throw(404, 'Series not found')
    }
  }

  const query = parsePagination(ctx.query as Record<string, string | string[] | undefined>)
  query.seriesId = targetSeries === 'none' ? 'none' : targetSeries
  let filter: Record<string, unknown>
  try {
    filter = await buildAssetFilter(query)
  } catch (error) {
    if ((error as { code?: string } | null)?.code === 'INVALID_SERIES_ID') {
      ctx.throw(400, 'Invalid series identifier')
    }
    throw error
  }
  const skip = (query.page - 1) * query.pageSize
  const [assets, total] = await Promise.all([
    AssetModel.find(filter)
      .populate('tags')
      .populate('seriesId')
      .skip(skip)
      .limit(query.pageSize)
      .sort({ createdAt: -1 })
      .lean()
      .exec() as Promise<LeanAsset[]>,
    AssetModel.countDocuments(filter),
  ])

  const categoryLookup = await loadCategoryInfoMap(assets.map((asset) => asset.categoryId as Types.ObjectId))

  ctx.body = {
    data: assets.map((asset) => mapAssetDocument(asset, categoryLookup)),
    page: query.page,
    pageSize: query.pageSize,
    total,
  }
}

export async function deleteAssetSeries(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid series identifier')
  }
  const series = await AssetSeriesModel.findById(id).select('_id').lean().exec()
  if (!series) {
    ctx.throw(404, 'Series not found')
  }
  const updateResult = await AssetModel.updateMany({ seriesId: id }, { $set: { seriesId: null } }).exec()
  await AssetSeriesModel.findByIdAndDelete(id).exec()
  if ((updateResult.modifiedCount ?? 0) > 0) {
    await refreshManifest()
  }
  // Return explicit body to avoid client-side JSON parse errors when receiving 204 No Content
  ctx.status = 200
  ctx.body = {}
}

export async function createAssetTag(ctx: Context): Promise<void> {
  const payload = ctx.request.body as Record<string, unknown> | undefined
  const description = sanitizeString(payload?.description)
  const namesInput: string[] = []
  namesInput.push(...ensureArrayString(payload?.names))
  const singleName = sanitizeString(payload?.name)
  if (singleName) {
    namesInput.push(singleName)
  }
  const normalizedNames: string[] = []
  const seen = new Set<string>()
  namesInput.forEach((value) => {
    const trimmed = value.trim()
    if (!trimmed.length) {
      return
    }
    const normalized = trimmed.toLowerCase()
    if (seen.has(normalized)) {
      return
    }
    seen.add(normalized)
    normalizedNames.push(trimmed)
  })
  if (!normalizedNames.length) {
    ctx.throw(400, 'Tag name is required')
  }

  const existing = (await AssetTagModel.find({ name: { $in: normalizedNames } }).lean().exec()) as AssetTagDocument[]
  const existingNameMap = new Map<string, AssetTagDocument>()
  existing.forEach((tag) => {
    existingNameMap.set(tag.name.trim().toLowerCase(), tag)
  })

  const created: AssetTagDocument[] = []
  for (const name of normalizedNames) {
    const normalized = name.trim().toLowerCase()
    if (existingNameMap.has(normalized)) {
      continue
    }
    try {
      const tag = await AssetTagModel.create({ name, description })
      created.push(tag)
      existingNameMap.set(normalized, tag)
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const duplicated = await AssetTagModel.findOne({ name }).lean().exec()
        if (duplicated) {
          existingNameMap.set(normalized, duplicated as AssetTagDocument)
        }
        continue
      }
      throw error
    }
  }

  const responseTags = normalizedNames
    .map((name) => existingNameMap.get(name.trim().toLowerCase()))
    .filter((tag): tag is AssetTagDocument => !!tag)
    .map((tag) => mapAssetTagDocument(tag))

  ctx.status = created.length > 0 ? 201 : 200
  ctx.body = {
    tags: responseTags,
    createdTagIds: created.map((tag) => (tag._id as Types.ObjectId).toString()),
  }
}

export async function updateAssetTag(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid tag id')
  }
  const payload = ctx.request.body as Record<string, unknown> | undefined
  const name = sanitizeString(payload?.name)
  const description = sanitizeString(payload?.description)
  if (!name) {
    ctx.throw(400, 'Tag name is required')
  }
  const duplicate = await AssetTagModel.findOne({ name, _id: { $ne: id } }).select('_id').lean().exec()
  if (duplicate) {
    ctx.throw(409, 'Tag name already exists')
  }
  const updated = await AssetTagModel.findByIdAndUpdate(id, { name, description }, { new: true }).lean().exec()
  if (!updated) {
    ctx.throw(404, 'Tag not found')
  }
  ctx.body = {
    id: (updated._id as Types.ObjectId).toString(),
    name: updated.name,
    description: sanitizeString(updated.description),
    createdAt: updated.createdAt instanceof Date ? updated.createdAt.toISOString() : new Date(updated.createdAt).toISOString(),
    updatedAt: updated.updatedAt instanceof Date ? updated.updatedAt.toISOString() : new Date(updated.updatedAt).toISOString(),
  }
}

export async function deleteAssetTag(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid tag id')
  }
  const inUse = await AssetModel.exists({ tags: id })
  if (inUse) {
    ctx.throw(409, 'Cannot delete tag that is in use')
  }
  await AssetTagModel.findByIdAndDelete(id)
  // Return explicit body to avoid client-side JSON parse errors when receiving 204 No Content
  ctx.status = 200
  ctx.body = {}
}

export async function getProjectDirectories(ctx: Context): Promise<void> {
  await ensureDefaultCategories()
  const [categories, assets] = await Promise.all([
    (await AssetCategoryModel.find().lean().exec()) as AssetCategoryData[],
    (await AssetModel.find().lean().exec()) as AssetData[],
  ])
  const directories = mapDirectory(categories, assets)
  ctx.body = directories
}

export async function getAssetManifest(ctx: Context): Promise<void> {
  const manifest = (await readManifestFromDisk()) ?? (await refreshManifest())
  ctx.set('Cache-Control', 'no-store')
  ctx.type = 'application/json'
  ctx.body = manifest
}

export async function refreshAssetManifest(ctx: Context): Promise<void> {
  const manifest = await refreshManifest()
  ctx.set('Cache-Control', 'no-store')
  ctx.type = 'application/json'
  ctx.body = manifest
}
