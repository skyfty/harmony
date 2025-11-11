import { AssetTypes, DEFAULT_ASSET_TYPE, isAssetType } from '@harmony/schema/asset-types'
import type { AssetType } from '@harmony/schema/asset-types'
import type { Context } from 'koa'
import path from 'node:path'
import fs from 'fs-extra'
import { nanoid } from 'nanoid'
import { Types } from 'mongoose'
import type { AssetCategoryDocument, AssetDocument, AssetTagDocument } from '@/types/models'
import { AssetCategoryModel } from '@/models/AssetCategory'
import { AssetModel } from '@/models/Asset'
import { AssetTagModel } from '@/models/AssetTag'
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

const DEFAULT_CATEGORIES: Array<{ name: string; type: AssetDocument['type'] }> = [
  { name: 'Models', type: 'model' },
  { name: 'Meshes', type: 'mesh' },
  { name: 'Images', type: 'image' },
  { name: 'Textures', type: 'texture' },
  { name: 'Materials', type: 'material' },
  { name: 'Prefabs', type: 'prefab' },
  { name: 'Videos', type: 'video' },
  { name: 'Files', type: 'file' },
]

type UploadedFile = {
  filepath: string
  originalFilename?: string | null
  newFilename?: string | null
  mimetype?: string | null
  size?: number
}

type LeanAsset = AssetDocument & { tags?: AssetTagDocument[] }

type AssetResponse = {
  id: string
  name: string
  categoryId: string
  type: AssetDocument['type']
  tags: Array<{ id: string; name: string }>
  tagIds: string[]
  size: number
  url: string
  downloadUrl: string
  previewUrl: string | null
  thumbnailUrl: string | null
  description: string | null
  originalFilename: string | null
  mimeType: string | null
  createdAt: string
  updatedAt: string
}

type AssetManifestTag = {
  id: string
  name: string
}

type AssetManifestEntry = {
  id: string
  name: string
  type: AssetDocument['type']
  tags: AssetManifestTag[]
  tagIds: string[]
  downloadUrl: string
  thumbnailUrl: string | null
  description: string | null
  createdAt: string
  updatedAt: string
  size: number
}

type AssetManifest = {
  generatedAt: string
  assets: AssetManifestEntry[]
}

type AssetCategoryData = {
  _id: Types.ObjectId
  name: AssetCategoryDocument['name']
  type: AssetCategoryDocument['type']
  description?: AssetCategoryDocument['description']
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
  url: string
  fileKey: string
  previewUrl?: string | null
  thumbnailUrl?: string | null
  description?: string | null
  originalFilename?: string | null
  mimeType?: string | null
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

interface ProjectDirectoryAsset {
  id: string
  name: string
  type: AssetDocument['type']
  downloadUrl: string
  previewColor: string
  thumbnail: string | null
  description: string | null
  gleaned: boolean
}

interface ProjectDirectory {
  id: string
  name: string
  type: AssetCategoryDocument['type']
  assets: ProjectDirectoryAsset[]
}

type AssetSource = LeanAsset | AssetData

type AssetListQuery = {
  page: number
  pageSize: number
  keyword?: string
  types?: AssetDocument['type'][]
  tagIds?: string[]
  categoryId?: string
}

type AssetMutationPayload = {
  name?: string
  type?: string
  description?: string | null
  tagIds?: string[]
  categoryId?: string | null
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

function sanitizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
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

async function ensureDefaultCategories(): Promise<void> {
  const existing = await AssetCategoryModel.find({ name: { $in: DEFAULT_CATEGORIES.map((category) => category.name) } })
    .select('name')
    .lean()
    .exec()
  const existingNames = new Set(existing.map((category) => category.name))
  const pending = DEFAULT_CATEGORIES.filter((category) => !existingNames.has(category.name))
  if (pending.length > 0) {
    await AssetCategoryModel.insertMany(pending).catch(() => undefined)
  }
}

async function resolveCategoryId(type: AssetDocument['type'], categoryId?: string | null): Promise<Types.ObjectId> {
  await ensureDefaultCategories()
  if (categoryId && Types.ObjectId.isValid(categoryId)) {
    const existing = await AssetCategoryModel.findById(categoryId).select('_id').lean().exec()
    if (existing?._id) {
      return existing._id
    }
  }
  const matched = await AssetCategoryModel.findOne({ type }).sort({ createdAt: 1 }).select('_id').lean().exec()
  if (matched?._id) {
    return matched._id
  }
  const fallbackName = `${type.charAt(0).toUpperCase()}${type.slice(1)}s`
  const created = await AssetCategoryModel.create({ name: fallbackName, type })
  return created._id as Types.ObjectId
}

function mapTagDocument(tag: AssetTagDocument | Types.ObjectId): { id: string; name: string } | null {
  if (tag instanceof Types.ObjectId) {
    return { id: tag.toString(), name: tag.toString() }
  }
  if (!tag) {
    return null
  }
  const id = (tag._id as Types.ObjectId).toString()
  return { id, name: tag.name }
}

function mapAssetDocument(asset: AssetSource): AssetResponse {
  const assetId = (asset._id as Types.ObjectId).toString()
  const categoryObjectId = (asset.categoryId as Types.ObjectId).toString()
  const tagsRaw = Array.isArray(asset.tags) ? asset.tags : []
  const tags = tagsRaw
    .map((tag) => mapTagDocument(tag as AssetTagDocument | Types.ObjectId))
    .filter((tag): tag is { id: string; name: string } => !!tag)

  const previewUrl = asset.previewUrl ?? asset.thumbnailUrl ?? null

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
    type: asset.type,
    tags,
    tagIds: tags.map((tag) => tag.id),
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

function mapAssetTagDocument(tag: AssetTagDocumentLike): {
  id: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
} {
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

function mapManifestEntry(asset: AssetSource): AssetManifestEntry {
  const response = mapAssetDocument(asset)
  return {
    id: response.id,
    name: response.name,
    type: response.type,
    tags: response.tags,
    tagIds: response.tagIds,
    downloadUrl: response.downloadUrl,
    thumbnailUrl: response.thumbnailUrl,
    description: response.description,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
    size: response.size,
  }
}

async function readManifestFromDisk(): Promise<AssetManifest | null> {
  const manifestPath = path.join(appConfig.assetStoragePath, MANIFEST_FILENAME)
  if (!(await fs.pathExists(manifestPath))) {
    return null
  }
  try {
    const content = await fs.readFile(manifestPath, 'utf-8')
    return JSON.parse(content) as AssetManifest
  } catch (error) {
    console.warn('Failed to read asset manifest from disk', error)
    return null
  }
}

async function writeManifestToDisk(manifest: AssetManifest): Promise<void> {
  await ensureStorageDir()
  const manifestPath = path.join(appConfig.assetStoragePath, MANIFEST_FILENAME)
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
}

async function buildManifest(): Promise<AssetManifest> {
  const assets = (await AssetModel.find()
    .sort({ updatedAt: -1 })
    .populate('tags')
    .lean()
    .exec()) as LeanAsset[]
  const entries = assets.map((asset) => mapManifestEntry(asset))
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

function buildAssetFilter(query: AssetListQuery): Record<string, unknown> {
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
  if (query.categoryId && Types.ObjectId.isValid(query.categoryId)) {
    filter.categoryId = new Types.ObjectId(query.categoryId)
  }
  return filter
}

async function refreshManifest(): Promise<AssetManifest> {
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
  return {
    name: sanitizeString(rawBody.name) ?? undefined,
    type: sanitizeString(rawBody.type) ?? undefined,
    description: sanitizeString(rawBody.description),
    tagIds: tagIds.length ? tagIds : undefined,
    categoryId: sanitizeString(rawBody.categoryId),
  }
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
  const categoryId = sanitizeString(Array.isArray(query.categoryId) ? query.categoryId[0] : query.categoryId)
  return {
    page: page > 0 ? page : 1,
    pageSize: pageSize > 0 ? pageSize : 20,
    keyword,
    types: validTypes.length ? validTypes : undefined,
    tagIds: tagIds.length ? tagIds : undefined,
    categoryId: categoryId ?? undefined,
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
        }
      })

    return {
      id: category._id.toString(),
      name: category.name,
      type: category.type,
      assets: categoryAssets,
    }
  })
}

export async function listResourceCategories(ctx: Context): Promise<void> {
  await ensureDefaultCategories()
  const categories = (await AssetCategoryModel.find()
    .sort({ createdAt: 1 })
    .lean()
    .exec()) as AssetCategoryData[]
  ctx.body = categories.map((category) => ({
    id: category._id.toString(),
    name: category.name,
    type: category.type,
    description: sanitizeString(category.description),
  }))
}

export async function listAssets(ctx: Context): Promise<void> {
  const query = parsePagination(ctx.query as Record<string, string | string[] | undefined>)
  const filter = buildAssetFilter(query)
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

  ctx.body = {
    data: assets.map((asset) => mapAssetDocument(asset)),
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
  const asset = (await AssetModel.findById(id).populate('tags').lean().exec()) as LeanAsset | null
  if (!asset) {
    ctx.throw(404, 'Asset not found')
  }
  ctx.body = mapAssetDocument(asset)
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

  const categoryId = await resolveCategoryId(type, payload.categoryId)

  const asset = await AssetModel.create({
    name: payload.name ?? fileInfo.originalFilename ?? fileInfo.fileKey,
    categoryId,
    type,
    tags: tagObjectIds,
    size: fileInfo.size,
    url: fileInfo.url,
    fileKey: fileInfo.fileKey,
    previewUrl: thumbnailInfo?.url ?? (type === 'image' ? fileInfo.url : null),
    thumbnailUrl: thumbnailInfo?.url ?? (type === 'image' ? fileInfo.url : null),
    description: payload.description ?? null,
    originalFilename: fileInfo.originalFilename,
    mimeType: fileInfo.mimeType,
  })

  const populated = (await asset.populate('tags')) as AssetDocument & { tags: AssetTagDocument[] }
  const response = mapAssetDocument(populated)
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

  if (payload.name) {
    updates.name = payload.name
  }
  if (payload.description !== undefined) {
    updates.description = payload.description
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
      const nextCategoryId = await resolveCategoryId(normalizedType, payload.categoryId)
      updates.categoryId = nextCategoryId
    } else if (payload.categoryId && Types.ObjectId.isValid(payload.categoryId)) {
      updates.categoryId = new Types.ObjectId(payload.categoryId)
    }
  } else if (payload.categoryId && Types.ObjectId.isValid(payload.categoryId)) {
    updates.categoryId = new Types.ObjectId(payload.categoryId)
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

  if (Object.keys(updates).length === 0) {
    ctx.body = mapAssetDocument(await asset.populate('tags'))
    return
  }

  await AssetModel.updateOne({ _id: id }, { $set: updates })
  const updated = (await AssetModel.findById(id).populate('tags').lean().exec()) as LeanAsset | null
  if (!updated) {
    ctx.throw(500, 'Failed to update asset')
  }
  await refreshManifest()
  ctx.body = mapAssetDocument(updated)
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
  ctx.status = 204
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
  ctx.status = 204
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
