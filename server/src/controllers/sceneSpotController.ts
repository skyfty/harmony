import type { Context } from 'koa'
import { Types } from 'mongoose'
import { FileUploadModel } from '@/models/FileUpload'
import { SceneModel } from '@/models/Scene'
import { SceneSpotModel } from '@/models/SceneSpot'
import { HotSpotModel } from '@/models/HotSpot'
import { FeaturedSpotModel } from '@/models/FeaturedSpot'
import { deleteStoredFile } from '@/services/uploadStorageService'
import { type UploadedFilePayload } from '@/services/sceneService'

type SceneSpotMutationPayload = {
  sceneId?: string
  title?: string
  description?: string | null
  address?: string | null
  order?: number
  isHome?: boolean
  isFeatured?: boolean
  isHot?: boolean
  averageRating?: number
  ratingCount?: number
  favoriteCount?: number
  removeCoverImage?: boolean | number | string
  removeSlides?: boolean | number | string
  retainSlides?: unknown
  coverImage?: unknown
  slides?: unknown
  distance?: string | null
  phone?: string | null
  location?: unknown
  locationLat?: unknown
  locationLng?: unknown
  category?: unknown
  categoryId?: unknown
}

type RequestFilesMap = Record<string, unknown> | undefined

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

function parseCoordinate(value: unknown): number {
  if (value === undefined || value === null) return NaN
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return NaN
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : NaN
  }
  return NaN
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

async function deleteStoredFilesByUrls(urls: Array<string | null | undefined>): Promise<void> {
  const normalizedUrls = Array.from(new Set(urls.map((url) => toNullableString(url)).filter(Boolean)))
  if (!normalizedUrls.length) {
    return
  }

  const uploads = await FileUploadModel.find({ url: { $in: normalizedUrls }, module: 'scene-spot' }).lean().exec()
  for (const upload of uploads) {
    const url = toNullableString(upload.url)
    if (!url) {
      continue
    }
    const referenceCount = await SceneSpotModel.countDocuments({
      $or: [{ coverImage: url }, { slides: url }],
    }).exec()
    if (referenceCount > 0) {
      continue
    }

    await Promise.all([
      deleteStoredFile(String(upload.fileKey)).catch(() => undefined),
      FileUploadModel.findByIdAndDelete(upload._id).exec(),
    ])
  }
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

function mapSceneSpot(spot: any, sceneCheckpointTotal = 0) {
  return {
    id: String(spot._id),
    sceneId: String(spot.sceneId),
    categoryId: spot && spot.category ? (typeof spot.category === 'string' ? String(spot.category) : String((spot.category as any)._id ?? '')) : null,
    category: spot && spot.category && typeof spot.category === 'object' ? { id: String((spot.category as any)._id), name: String((spot.category as any).name ?? ''), slug: String((spot.category as any).slug ?? '') } : null,
    sceneCheckpointTotal,
    title: spot.title,
    coverImage: toNullableString(spot.coverImage),
    slides: Array.isArray(spot.slides) ? spot.slides.map((item: unknown) => String(item)) : [],
    checkpointTotal: sceneCheckpointTotal,
    description: typeof spot.description === 'string' ? spot.description : '',
    address: typeof spot.address === 'string' ? spot.address : '',
    distance: typeof spot.distance === 'string' ? spot.distance : '',
    order: typeof spot.order === 'number' ? spot.order : 0,
    isHome: spot.isHome === true,
    isFeatured: spot.isFeatured === true,
    isHot: spot.isHot === true,
    averageRating: typeof spot.averageRating === 'number' ? spot.averageRating : 0,
    ratingCount: typeof spot.ratingCount === 'number' ? spot.ratingCount : 0,
    favoriteCount: typeof spot.favoriteCount === 'number' ? spot.favoriteCount : 0,
    phone: typeof spot.phone === 'string' ? spot.phone : null,
    location:
      spot && spot.location && Array.isArray(spot.location.coordinates) && spot.location.coordinates.length === 2
        ? { lat: Number(spot.location.coordinates[1]), lng: Number(spot.location.coordinates[0]) }
        : null,
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

async function loadSceneCheckpointTotalMap(sceneIds: string[]): Promise<Map<string, number>> {
  const normalizedSceneIds = Array.from(new Set(sceneIds.filter((id) => Types.ObjectId.isValid(id))))
  if (!normalizedSceneIds.length) {
    return new Map()
  }

  const rows = await SceneModel.find(
    { _id: { $in: normalizedSceneIds.map((id) => new Types.ObjectId(id)) } },
    { _id: 1, checkpointTotal: 1 },
  )
    .lean()
    .exec()

  const out = new Map<string, number>()
  for (const row of rows) {
    const id = String((row as { _id?: unknown })._id ?? '')
    const raw = Number((row as { checkpointTotal?: unknown }).checkpointTotal)
    out.set(id, Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0)
  }
  return out
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
      .populate('category', 'name slug')
      .sort({ order: 1, createdAt: 1 })
      .skip((pageNumber - 1) * limit)
      .limit(limit)
      .lean()
      .exec(),
    SceneSpotModel.countDocuments(query).exec(),
  ])

  const checkpointMap = await loadSceneCheckpointTotalMap(rows.map((row) => String((row as { sceneId?: unknown }).sceneId ?? '')))

  ctx.body = {
    data: rows.map((row) => {
      const sceneId = String((row as { sceneId?: unknown }).sceneId ?? '')
      return mapSceneSpot(row, checkpointMap.get(sceneId) ?? 0)
    }),
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

  const row = await SceneSpotModel.findById(id).populate('category', 'name slug').lean().exec()
  if (!row) {
    ctx.throw(404, 'Scene spot not found')
  }
  const sceneId = String((row as { sceneId?: unknown }).sceneId ?? '')
  const checkpointMap = await loadSceneCheckpointTotalMap([sceneId])
  ctx.body = mapSceneSpot(row, checkpointMap.get(sceneId) ?? 0)
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
  if ('checkpointTotal' in body && (body as Record<string, unknown>).checkpointTotal !== undefined) {
    ctx.throw(400, 'checkpointTotal is read-only and derived from scene')
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
  // category is required for creating a scene spot
  const rawCategory = (body as any).category ?? (body as any).categoryId
  if (rawCategory === undefined) {
    ctx.throw(400, 'Category id is required')
  }
  const cat = toNullableString(rawCategory)
  if (!cat) {
    ctx.throw(400, 'Category id is required')
  }
  if (!Types.ObjectId.isValid(cat)) {
    ctx.throw(400, 'Invalid category id')
  }
  const categoryToSet: string = cat

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

  const bodyCoverImage = body.coverImage === undefined ? undefined : toNullableString(body.coverImage)
  const bodySlides = body.slides === undefined ? undefined : parseSlides(body.slides)
  let uploadedCoverImageUrl: string | null = bodyCoverImage ?? null
  const uploadedSlideUrls: string[] = bodySlides ?? []
  if (coverFiles.length || slideFiles.length) {
    ctx.throw(400, 'Please upload images through the file upload center and submit URLs')
  }

  let created
  try {

    const createPayload: any = {
      sceneId,
      title,
      coverImage: uploadedCoverImageUrl,
      slides: uploadedSlideUrls,
      description: toNullableString(body.description) ?? '',
      distance: toNullableString(body.distance) ?? '',
      address: toNullableString(body.address) ?? '',
      phone: toNullableString(body.phone) ?? null,
      // location will be added below only if valid coords exist
      order: toNumberOrDefault(body.order, 0),
      isHome: toBoolean(body.isHome) ?? false,
      isFeatured: toBoolean((body as any).isFeatured) ?? false,
      isHot: toBoolean((body as any).isHot) ?? false,
      averageRating,
      ratingCount,
      favoriteCount,
      ratingTotalScore: Number((averageRating * ratingCount).toFixed(2)),
    }

    createPayload.category = categoryToSet

    // attach location only when both coordinates are present
    const createLocation = ((): any => {
      const lat = parseCoordinate(body.locationLat ?? (body.location && (body.location as any).lat))
      const lng = parseCoordinate(body.locationLng ?? (body.location && (body.location as any).lng))
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { type: 'Point', coordinates: [Number(lng), Number(lat)] }
      }
      if (typeof body.location === 'string') {
        try {
          const parsed = JSON.parse(body.location)
          if (parsed && Array.isArray(parsed.coordinates) && parsed.coordinates.length === 2) {
            const px = parseCoordinate(parsed.coordinates[0])
            const py = parseCoordinate(parsed.coordinates[1])
            if (Number.isFinite(px) && Number.isFinite(py)) {
              return { type: 'Point', coordinates: [Number(px), Number(py)] }
            }
          }
        } catch {
          // ignore
        }
      }
      return undefined
    })()

    if (createLocation !== undefined) {
      createPayload.location = createLocation
    }

    created = await SceneSpotModel.create(createPayload)
  } catch (error) {
    throw error
  }

  const row = await SceneSpotModel.findById(created._id).populate('category', 'name slug').lean().exec()
  ctx.status = 201
  const checkpointMap = await loadSceneCheckpointTotalMap([sceneId])
  ctx.body = mapSceneSpot(row, checkpointMap.get(sceneId) ?? 0)
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

  if ('checkpointTotal' in body && (body as Record<string, unknown>).checkpointTotal !== undefined) {
    ctx.throw(400, 'checkpointTotal is read-only and derived from scene')
  }

  const removeCoverImage = toBoolean(body.removeCoverImage) === true
  const removeSlides = toBoolean(body.removeSlides) === true

  const nextIsHome = toBoolean(body.isHome)
  const nextIsFeatured = toBoolean((body as any).isFeatured)
  const nextIsHot = toBoolean((body as any).isHot)
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
  // handle optional category update (cannot be cleared to null)
  const rawCategory = (body as any).category ?? (body as any).categoryId
  let categoryToSet: string | undefined = undefined
  if (rawCategory !== undefined) {
    const cat = toNullableString(rawCategory)
    if (!cat) {
      ctx.throw(400, 'Category id is required')
    }
    if (!Types.ObjectId.isValid(cat)) {
      ctx.throw(400, 'Invalid category id')
    }
    categoryToSet = cat
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

  const bodyCoverImage = body.coverImage === undefined ? undefined : toNullableString(body.coverImage)
  const bodySlides = body.slides === undefined ? undefined : parseSlides(body.slides)
  let uploadedCoverImageUrl: string | null = bodyCoverImage ?? null
  const uploadedSlideUrls: string[] = bodySlides ?? []
  if (coverFiles.length || slideFiles.length) {
    ctx.throw(400, 'Please upload images through the file upload center and submit URLs')
  }

  const currentCoverImage = toNullableString(current.coverImage)
  const currentSlides = Array.isArray(current.slides) ? current.slides.map((item) => String(item).trim()).filter(Boolean) : []

  const nextCoverImage = bodyCoverImage !== undefined ? uploadedCoverImageUrl : removeCoverImage ? null : currentCoverImage

  const nextSlides = bodySlides !== undefined ? uploadedSlideUrls : removeSlides ? [] : currentSlides
  if (nextSlides.length > MAX_SLIDES_COUNT) {
    ctx.throw(400, `Slides cannot exceed ${MAX_SLIDES_COUNT} images`)
  }
  // compute next phone & location values
  const nextPhone = body.phone === undefined ? (typeof current.phone === 'string' ? current.phone : null) : toNullableString(body.phone) ?? null
  // determine if request intends to change location
  const hasLocationInput = Object.prototype.hasOwnProperty.call(body, 'location') ||
    Object.prototype.hasOwnProperty.call(body, 'locationLat') ||
    Object.prototype.hasOwnProperty.call(body, 'locationLng')

  const parsedNextLocation = (() => {
    const hasLatProp = Object.prototype.hasOwnProperty.call(body, 'locationLat')
    const hasLngProp = Object.prototype.hasOwnProperty.call(body, 'locationLng')
    const hasLocProp = Object.prototype.hasOwnProperty.call(body, 'location')

    // if lat/lng explicit props are present, prefer them
    if (hasLatProp || hasLngProp) {
      const latRaw = (body as any).locationLat
      const lngRaw = (body as any).locationLng
      const lat = parseCoordinate(latRaw)
      const lng = parseCoordinate(lngRaw)
      const latEmpty = latRaw === undefined || latRaw === null || (typeof latRaw === 'string' && latRaw.trim() === '')
      const lngEmpty = lngRaw === undefined || lngRaw === null || (typeof lngRaw === 'string' && lngRaw.trim() === '')

      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { type: 'Point', coordinates: [Number(lng), Number(lat)] }
      }
      // explicit both empty -> clear location
      if ((hasLatProp && latEmpty) && (hasLngProp && lngEmpty)) {
        return null
      }
      // otherwise invalid mix (one provided but not both valid)
      return undefined
    }

    if (hasLocProp) {
      const raw = (body as any).location
      if (raw === null) return null
      if (typeof raw === 'string') {
        if (raw.trim() === '') return null
        try {
          const parsed = JSON.parse(raw)
          if (parsed && Array.isArray(parsed.coordinates) && parsed.coordinates.length === 2) {
            const px = parseCoordinate(parsed.coordinates[0])
            const py = parseCoordinate(parsed.coordinates[1])
            if (Number.isFinite(px) && Number.isFinite(py)) {
              return { type: 'Point', coordinates: [Number(px), Number(py)] }
            }
          }
        } catch {
          // ignore
        }
      }
      return undefined
    }

    return undefined
  })()

  let updated
  try {

    const updatePayload: any = {
      sceneId: nextSceneId,
      title: title ?? current.title,
      coverImage: nextCoverImage,
      slides: nextSlides,
      description: body.description === undefined ? current.description : toNullableString(body.description) ?? '',
      distance: body.distance === undefined ? current.distance : toNullableString(body.distance) ?? '',
      address: body.address === undefined ? current.address : toNullableString(body.address) ?? '',
      order: body.order === undefined ? current.order : toNumberOrDefault(body.order, current.order ?? 0),
      isHome: nextIsHome === null ? current.isHome : nextIsHome,
      isFeatured: nextIsFeatured === null ? current.isFeatured : nextIsFeatured,
      isHot: nextIsHot === null ? current.isHot : nextIsHot,
      averageRating: nextAverageRating,
      ratingCount: nextRatingCount,
      favoriteCount: nextFavoriteCount,
      phone: nextPhone,
      ratingTotalScore: Number((nextAverageRating * nextRatingCount).toFixed(2)),
    }
    if (categoryToSet !== undefined) {
      updatePayload.category = categoryToSet
    }

    // attach location only when client provided location inputs
    if (hasLocationInput) {
      if (parsedNextLocation === undefined) {
        ctx.throw(400, 'Invalid location coordinates')
      }
      updatePayload.location = parsedNextLocation
    }

    updated = await SceneSpotModel.findByIdAndUpdate(id, updatePayload, { new: true }).lean().exec()
  } catch (error) {
    throw error
  }

  const removedUrls: string[] = []
  if (currentCoverImage && currentCoverImage !== nextCoverImage) {
    removedUrls.push(currentCoverImage)
  }
  currentSlides.forEach((url) => {
    if (url && !nextSlides.includes(url)) {
      removedUrls.push(url)
    }
  })
  await deleteStoredFilesByUrls(removedUrls)

  // ensure category is populated for response
  const updatedRow = updated ? await SceneSpotModel.findById((updated as any)._id).populate('category', 'name slug').lean().exec() : null
  const updatedSceneId = String((updatedRow as { sceneId?: unknown })?.sceneId ?? '')
  const checkpointMap = await loadSceneCheckpointTotalMap([updatedSceneId])
  ctx.body = mapSceneSpot(updatedRow ?? updated, checkpointMap.get(updatedSceneId) ?? 0)
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

    // remove any HotSpot / FeaturedSpot records referencing this scene spot
    try {
      await Promise.all([
        HotSpotModel.deleteMany({ sceneSpotId: deleted._id }).exec(),
        FeaturedSpotModel.deleteMany({ sceneSpotId: deleted._id }).exec(),
      ])
    } catch (err) {
      // best-effort: ignore deletion errors to avoid blocking primary delete
    }
  }
  ctx.status = 200
  ctx.body = {}
}
