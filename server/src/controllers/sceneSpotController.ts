import type { Context } from 'koa'
import path from 'node:path'
import fs from 'fs-extra'
import { Types } from 'mongoose'
import { nanoid } from 'nanoid'
import { appConfig } from '@/config/env'
import { SceneModel } from '@/models/Scene'
import { SceneSpotModel } from '@/models/SceneSpot'
import { deleteSceneFile, type UploadedFilePayload } from '@/services/sceneService'

type SceneSpotMutationPayload = {
  sceneId?: string
  title?: string
  description?: string | null
  address?: string | null
  checkpointTotal?: number
  order?: number
  isFeatured?: boolean
  averageRating?: number
  ratingCount?: number
  favoriteCount?: number
  removeCoverImage?: boolean | number | string
  removeSlides?: boolean | number | string
  retainSlides?: unknown
  coverImage?: unknown
  slides?: unknown
}

type RequestFilesMap = Record<string, unknown> | undefined

const SCENE_SPOT_STORAGE_PREFIX = 'scene-spots'
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const MAX_SLIDES_COUNT = 10

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function isDataUrl(value: string): boolean {
  return /^data:/i.test(value.trim())
}

function sanitizeUploadedFilePayload(value: unknown): UploadedFilePayload | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const file = value as UploadedFilePayload & { path?: string }
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

function extractUploadedFiles(files: RequestFilesMap, field: string): UploadedFilePayload[] {
  if (!files) {
    return []
  }
  const raw = files[field]
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  return list.map(sanitizeUploadedFilePayload).filter((file): file is UploadedFilePayload => Boolean(file))
}

function normalizeFileKey(input: string): string {
  return input.replace(/\\+/g, '/').replace(/^\/+/, '')
}

function buildPublicUrl(fileKey: string): string {
  const base = appConfig.assetPublicUrl.replace(/\/?$/, '')
  return `${base}/${normalizeFileKey(fileKey)}`
}

function resolveStorageAbsolutePath(fileKey: string): string {
  const root = path.resolve(appConfig.assetStoragePath)
  const absolutePath = path.resolve(root, normalizeFileKey(fileKey))
  if (!absolutePath.startsWith(root)) {
    throw new Error('Invalid file path')
  }
  return absolutePath
}

async function ensureSceneSpotStorageDir(): Promise<void> {
  const root = path.resolve(appConfig.assetStoragePath)
  await fs.ensureDir(path.join(root, SCENE_SPOT_STORAGE_PREFIX))
}

async function storeSceneSpotFile(file: UploadedFilePayload): Promise<{ fileKey: string; url: string }> {
  if (!file.filepath) {
    throw new Error('Invalid upload payload')
  }
  await ensureSceneSpotStorageDir()
  const extension = typeof file.originalFilename === 'string' ? path.extname(file.originalFilename) : ''
  const fileKey = `${SCENE_SPOT_STORAGE_PREFIX}/${nanoid(16)}${extension}`
  const targetPath = resolveStorageAbsolutePath(fileKey)
  await fs.copy(file.filepath, targetPath)
  await fs.remove(file.filepath).catch(() => undefined)
  return { fileKey, url: buildPublicUrl(fileKey) }
}

function toStoredFileKeyFromUrl(input: unknown): string | null {
  const raw = toNullableString(input)
  if (!raw || isDataUrl(raw)) {
    return null
  }

  try {
    const parsed = new URL(raw)
    const publicBase = new URL(appConfig.assetPublicUrl.endsWith('/') ? appConfig.assetPublicUrl : `${appConfig.assetPublicUrl}/`)
    if (parsed.origin === publicBase.origin && parsed.pathname.startsWith(publicBase.pathname)) {
      return normalizeFileKey(parsed.pathname.slice(publicBase.pathname.length)) || null
    }
    return null
  } catch {
    if (raw.startsWith('/')) {
      const publicBase = new URL(appConfig.assetPublicUrl.endsWith('/') ? appConfig.assetPublicUrl : `${appConfig.assetPublicUrl}/`)
      if (raw.startsWith(publicBase.pathname)) {
        return normalizeFileKey(raw.slice(publicBase.pathname.length)) || null
      }
      return null
    }
    if (raw.includes('://')) {
      return null
    }
    return normalizeFileKey(raw) || null
  }
}

async function deleteStoredFilesByUrls(urls: Array<string | null | undefined>): Promise<void> {
  const keys = new Set<string>()
  for (const url of urls) {
    const fileKey = toStoredFileKeyFromUrl(url)
    if (fileKey) {
      keys.add(fileKey)
    }
  }
  await Promise.all(Array.from(keys).map((fileKey) => deleteSceneFile(fileKey).catch(() => undefined)))
}

function validateImageUpload(file: UploadedFilePayload, fieldLabel: string): void {
  const mimeType = toNullableString(file.mimetype)
  if (!mimeType || !mimeType.toLowerCase().startsWith('image/')) {
    throw new Error(`${fieldLabel} must be an image file`)
  }
  if (typeof file.size === 'number' && file.size > MAX_IMAGE_SIZE) {
    throw new Error(`${fieldLabel} exceeds 5MB size limit`)
  }
}

function toNumberOrDefault(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    if (value === 1) {
      return true
    }
    if (value === 0) {
      return false
    }
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === '1' || normalized === 'true') {
      return true
    }
    if (normalized === '0' || normalized === 'false') {
      return false
    }
  }

  return null
}

function parseSlides(value: unknown): string[] {
  if (value == null || value === '') {
    return []
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return []
    }

    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean)
      }
    } catch {
      return trimmed
        .split(/[\n,]/g)
        .map((item) => item.trim())
        .filter(Boolean)
    }

    return []
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }

  return []
}

function parseStringArray(value: unknown): string[] {
  if (value == null || value === '') {
    return []
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof value !== 'string') {
    return []
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return []
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean)
    }
  } catch {
    return []
  }
  return []
}

function toNumberInRange(value: unknown, min: number, max: number): number | null {
  const parsed = Number(value)
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    return null
  }
  return parsed
}

function toNonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null
  }
  return parsed
}

function mapSceneSpot(spot: any) {
  return {
    id: String(spot._id),
    sceneId: String(spot.sceneId),
    title: spot.title,
    coverImage: toNullableString(spot.coverImage),
    slides: Array.isArray(spot.slides) ? spot.slides.map((item: unknown) => String(item)) : [],
    checkpointTotal: typeof spot.checkpointTotal === 'number' && spot.checkpointTotal >= 0 ? Math.floor(spot.checkpointTotal) : 0,
    description: typeof spot.description === 'string' ? spot.description : '',
    address: typeof spot.address === 'string' ? spot.address : '',
    order: typeof spot.order === 'number' ? spot.order : 0,
    isFeatured: spot.isFeatured === true,
    averageRating: typeof spot.averageRating === 'number' ? spot.averageRating : 0,
    ratingCount: typeof spot.ratingCount === 'number' ? spot.ratingCount : 0,
    favoriteCount: typeof spot.favoriteCount === 'number' ? spot.favoriteCount : 0,
    createdAt: spot.createdAt instanceof Date ? spot.createdAt.toISOString() : new Date(spot.createdAt).toISOString(),
    updatedAt: spot.updatedAt instanceof Date ? spot.updatedAt.toISOString() : new Date(spot.updatedAt).toISOString(),
  }
}

async function ensureSceneExists(sceneId: string): Promise<void> {
  const exists = await SceneModel.exists({ _id: sceneId })
  if (!exists) {
    throw new Error('Scene not found')
  }
}

function toPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

export async function listSceneSpots(ctx: Context): Promise<void> {
  const { keyword, page = '1', pageSize = '10', sceneId } = ctx.query as Record<string, string>
  const pageNumber = Math.max(toPositiveNumber(page, 1), 1)
  const limit = Math.min(Math.max(toPositiveNumber(pageSize, 10), 1), 100)
  const normalizedKeyword = toNonEmptyString(keyword)
  const normalizedSceneId = toNonEmptyString(sceneId)

  const query: Record<string, unknown> = {}

  if (normalizedSceneId) {
    if (!Types.ObjectId.isValid(normalizedSceneId)) {
      ctx.throw(400, 'Invalid scene id')
    }
    query.sceneId = normalizedSceneId
  }

  if (normalizedKeyword) {
    const regex = new RegExp(normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    query.$or = [{ title: regex }, { description: regex }, { address: regex }]
  }

  const [rows, total] = await Promise.all([
    SceneSpotModel.find(query)
      .sort({ order: 1, createdAt: 1 })
      .skip((pageNumber - 1) * limit)
      .limit(limit)
      .lean()
      .exec(),
    SceneSpotModel.countDocuments(query).exec(),
  ])

  ctx.body = {
    data: rows.map(mapSceneSpot),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function getSceneSpot(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene spot id')
  }

  const row = await SceneSpotModel.findById(id).lean().exec()
  if (!row) {
    ctx.throw(404, 'Scene spot not found')
  }
  ctx.body = mapSceneSpot(row)
}

export async function createSceneSpot(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as SceneSpotMutationPayload
  const files = ctx.request.files as RequestFilesMap

  const coverFiles = extractUploadedFiles(files, 'coverImage')
  if (coverFiles.length > 1) {
    ctx.throw(400, 'Only one cover image is allowed')
  }
  const slideFiles = extractUploadedFiles(files, 'slides')
  if (slideFiles.length > MAX_SLIDES_COUNT) {
    ctx.throw(400, `Slides cannot exceed ${MAX_SLIDES_COUNT} images`)
  }

  try {
    coverFiles.forEach((file) => validateImageUpload(file, 'Cover image'))
    slideFiles.forEach((file) => validateImageUpload(file, 'Slide image'))
  } catch (error) {
    ctx.throw(400, (error as Error).message)
  }

  if (body.coverImage !== undefined || body.slides !== undefined) {
    ctx.throw(400, 'coverImage/slides do not accept string payload, upload files only')
  }

  const sceneId = toNonEmptyString(body.sceneId)
  if (!sceneId) {
    ctx.throw(400, 'Scene id is required')
  }
  if (!Types.ObjectId.isValid(sceneId)) {
    ctx.throw(400, 'Invalid scene id')
  }

  try {
    await ensureSceneExists(sceneId)
  } catch {
    ctx.throw(404, 'Scene not found')
  }

  const title = toNonEmptyString(body.title)
  if (!title) {
    ctx.throw(400, 'Scene spot title is required')
  }

  const averageRating = body.averageRating === undefined ? 0 : toNumberInRange(body.averageRating, 0, 5)
  if (averageRating === null) {
    ctx.throw(400, 'Average rating must be between 0 and 5')
  }

  const ratingCount = body.ratingCount === undefined ? 0 : toNonNegativeInteger(body.ratingCount)
  if (ratingCount === null) {
    ctx.throw(400, 'Rating count must be a non-negative integer')
  }

  const favoriteCount = body.favoriteCount === undefined ? 0 : toNonNegativeInteger(body.favoriteCount)
  if (favoriteCount === null) {
    ctx.throw(400, 'Favorite count must be a non-negative integer')
  }

  const checkpointTotal = body.checkpointTotal === undefined ? 0 : toNonNegativeInteger(body.checkpointTotal)
  if (checkpointTotal === null) {
    ctx.throw(400, 'Checkpoint total must be a non-negative integer')
  }

  const uploadedFileKeys: string[] = []
  let coverImageUrl: string | null = null
  const slideUrls: string[] = []
  try {
    if (coverFiles[0]) {
      const stored = await storeSceneSpotFile(coverFiles[0])
      uploadedFileKeys.push(stored.fileKey)
      coverImageUrl = stored.url
    }

    for (const file of slideFiles) {
      const stored = await storeSceneSpotFile(file)
      uploadedFileKeys.push(stored.fileKey)
      slideUrls.push(stored.url)
    }
  } catch (error) {
    await Promise.all(uploadedFileKeys.map((fileKey) => deleteSceneFile(fileKey).catch(() => undefined)))
    throw error
  }

  let created
  try {
    created = await SceneSpotModel.create({
      sceneId,
      title,
      coverImage: coverImageUrl,
      slides: slideUrls,
      checkpointTotal,
      description: toNullableString(body.description) ?? '',
      address: toNullableString(body.address) ?? '',
      order: toNumberOrDefault(body.order, 0),
      isFeatured: toBoolean(body.isFeatured) ?? false,
      averageRating,
      ratingCount,
      favoriteCount,
      ratingTotalScore: Number((averageRating * ratingCount).toFixed(2)),
    })
  } catch (error) {
    await Promise.all(uploadedFileKeys.map((fileKey) => deleteSceneFile(fileKey).catch(() => undefined)))
    throw error
  }

  const row = await SceneSpotModel.findById(created._id).lean().exec()
  ctx.status = 201
  ctx.body = mapSceneSpot(row)
}

export async function updateSceneSpot(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene spot id')
  }

  const current = await SceneSpotModel.findById(id).lean().exec()
  if (!current) {
    ctx.throw(404, 'Scene spot not found')
  }

  const body = (ctx.request.body ?? {}) as SceneSpotMutationPayload
  const files = ctx.request.files as RequestFilesMap
  const coverFiles = extractUploadedFiles(files, 'coverImage')
  if (coverFiles.length > 1) {
    ctx.throw(400, 'Only one cover image is allowed')
  }
  const slideFiles = extractUploadedFiles(files, 'slides')
  if (slideFiles.length > MAX_SLIDES_COUNT) {
    ctx.throw(400, `Slides cannot exceed ${MAX_SLIDES_COUNT} images`)
  }

  try {
    coverFiles.forEach((file) => validateImageUpload(file, 'Cover image'))
    slideFiles.forEach((file) => validateImageUpload(file, 'Slide image'))
  } catch (error) {
    ctx.throw(400, (error as Error).message)
  }

  if (body.coverImage !== undefined || body.slides !== undefined) {
    ctx.throw(400, 'coverImage/slides do not accept string payload, upload files only')
  }

  const removeCoverImage = toBoolean(body.removeCoverImage) === true
  const removeSlides = toBoolean(body.removeSlides) === true
  const retainedSlides = body.retainSlides === undefined ? undefined : parseStringArray(body.retainSlides)
  if (retainedSlides?.some((url) => isDataUrl(url))) {
    ctx.throw(400, 'retainSlides does not accept base64 payload')
  }

  const nextIsFeatured = toBoolean(body.isFeatured)
  const title = body.title === undefined ? undefined : toNonEmptyString(body.title)
  if (body.title !== undefined && !title) {
    ctx.throw(400, 'Scene spot title is required')
  }

  const nextSceneId = body.sceneId === undefined ? String(current.sceneId) : toNonEmptyString(body.sceneId)
  if (!nextSceneId) {
    ctx.throw(400, 'Scene id is required')
  }
  if (!Types.ObjectId.isValid(nextSceneId)) {
    ctx.throw(400, 'Invalid scene id')
  }

  if (body.sceneId !== undefined && nextSceneId !== String(current.sceneId)) {
    try {
      await ensureSceneExists(nextSceneId)
    } catch {
      ctx.throw(404, 'Scene not found')
    }
  }

  const nextAverageRating =
    body.averageRating === undefined
      ? typeof current.averageRating === 'number'
        ? current.averageRating
        : 0
      : toNumberInRange(body.averageRating, 0, 5)
  if (nextAverageRating === null) {
    ctx.throw(400, 'Average rating must be between 0 and 5')
  }

  const nextRatingCount =
    body.ratingCount === undefined
      ? typeof current.ratingCount === 'number'
        ? current.ratingCount
        : 0
      : toNonNegativeInteger(body.ratingCount)
  if (nextRatingCount === null) {
    ctx.throw(400, 'Rating count must be a non-negative integer')
  }

  const nextFavoriteCount =
    body.favoriteCount === undefined
      ? typeof current.favoriteCount === 'number'
        ? current.favoriteCount
        : 0
      : toNonNegativeInteger(body.favoriteCount)
  if (nextFavoriteCount === null) {
    ctx.throw(400, 'Favorite count must be a non-negative integer')
  }

  const nextCheckpointTotal =
    body.checkpointTotal === undefined
      ? typeof current.checkpointTotal === 'number' && current.checkpointTotal >= 0
        ? Math.floor(current.checkpointTotal)
        : 0
      : toNonNegativeInteger(body.checkpointTotal)
  if (nextCheckpointTotal === null) {
    ctx.throw(400, 'Checkpoint total must be a non-negative integer')
  }

  const uploadedFileKeys: string[] = []
  let uploadedCoverImageUrl: string | null = null
  const uploadedSlideUrls: string[] = []
  try {
    if (coverFiles[0]) {
      const stored = await storeSceneSpotFile(coverFiles[0])
      uploadedFileKeys.push(stored.fileKey)
      uploadedCoverImageUrl = stored.url
    }
    for (const file of slideFiles) {
      const stored = await storeSceneSpotFile(file)
      uploadedFileKeys.push(stored.fileKey)
      uploadedSlideUrls.push(stored.url)
    }
  } catch (error) {
    await Promise.all(uploadedFileKeys.map((fileKey) => deleteSceneFile(fileKey).catch(() => undefined)))
    throw error
  }

  const currentCoverImage = toNullableString(current.coverImage)
  const currentSlides = Array.isArray(current.slides) ? current.slides.map((item) => String(item).trim()).filter(Boolean) : []

  const nextCoverImage = coverFiles.length ? uploadedCoverImageUrl : removeCoverImage ? null : currentCoverImage

  const nextSlidesBase = removeSlides ? [] : retainedSlides === undefined ? currentSlides : retainedSlides
  const nextSlides = [...nextSlidesBase, ...uploadedSlideUrls]
  if (nextSlides.length > MAX_SLIDES_COUNT) {
    await Promise.all(uploadedFileKeys.map((fileKey) => deleteSceneFile(fileKey).catch(() => undefined)))
    ctx.throw(400, `Slides cannot exceed ${MAX_SLIDES_COUNT} images`)
  }

  let updated
  try {
    updated = await SceneSpotModel.findByIdAndUpdate(
      id,
      {
        sceneId: nextSceneId,
        title: title ?? current.title,
        coverImage: nextCoverImage,
        slides: nextSlides,
        description: body.description === undefined ? current.description : toNullableString(body.description) ?? '',
        address: body.address === undefined ? current.address : toNullableString(body.address) ?? '',
        order: body.order === undefined ? current.order : toNumberOrDefault(body.order, current.order ?? 0),
        isFeatured: nextIsFeatured === null ? current.isFeatured : nextIsFeatured,
        averageRating: nextAverageRating,
        ratingCount: nextRatingCount,
        favoriteCount: nextFavoriteCount,
        checkpointTotal: nextCheckpointTotal,
        ratingTotalScore: Number((nextAverageRating * nextRatingCount).toFixed(2)),
      },
      { new: true },
    )
      .lean()
      .exec()
  } catch (error) {
    await Promise.all(uploadedFileKeys.map((fileKey) => deleteSceneFile(fileKey).catch(() => undefined)))
    throw error
  }

  const preservedUrls = new Set<string>()
  if (nextCoverImage) {
    preservedUrls.add(nextCoverImage)
  }
  nextSlides.forEach((url) => {
    if (url) {
      preservedUrls.add(url)
    }
  })

  const removedUrls: string[] = []
  if (currentCoverImage && !preservedUrls.has(currentCoverImage)) {
    removedUrls.push(currentCoverImage)
  }
  currentSlides.forEach((url) => {
    if (url && !preservedUrls.has(url)) {
      removedUrls.push(url)
    }
  })
  await deleteStoredFilesByUrls(removedUrls)

  ctx.body = mapSceneSpot(updated)
}

export async function deleteSceneSpot(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene spot id')
  }

  const deleted = await SceneSpotModel.findByIdAndDelete(id).lean().exec()
  if (deleted) {
    const urlsToDelete = [toNullableString(deleted.coverImage)]
    if (Array.isArray(deleted.slides)) {
      urlsToDelete.push(...deleted.slides.map((item: unknown) => toNullableString(item)).filter(Boolean))
    }
    await deleteStoredFilesByUrls(urlsToDelete)
  }
  ctx.status = 200
  ctx.body = {}
}
