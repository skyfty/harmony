import type { Context } from 'koa'
import { Types } from 'mongoose'
import { SceneModel } from '@/models/Scene'
import { SceneSpotModel } from '@/models/SceneSpot'
import { FeaturedSpotModel } from '@/models/FeaturedSpot'
import { HotSpotModel } from '@/models/HotSpot'
import { SceneSpotInteractionModel } from '@/models/SceneSpotInteraction'
import { SceneProductBindingModel } from '@/models/SceneProductBinding'
import { ProductModel } from '@/models/Product'
import { UserProductModel } from '@/models/UserProduct'
import { AppUserModel } from '@/models/AppUser'
import { SceneSpotCommentModel } from '@/models/SceneSpotComment'
import { ensureUserId, getOptionalUserId } from '@/controllers/miniprogram/utils'
import {
  asString,
  computeUserProductState,
  isProductApplicableToScene,
  objectIdString,
} from './miniDtoUtils'
import type { ProductDocument, SceneDocument } from '@/types/models'

const COMMENT_CONTENT_MAX_LENGTH = 500

function buildScenePackageDownloadUrl(ctx: Context, sceneId: string): string {
  return new URL(`/api/mini/scenes/${encodeURIComponent(sceneId)}/package`, ctx.origin).toString()
}

function ensureSceneId(ctx: Context): string {
  const { id } = ctx.params as { id?: string }
  if (!id || typeof id !== 'string' || !Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene id')
  }
  return id
}

function toStringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function toSafePage(value: unknown, fallback = 1): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback
  }
  return parsed
}

function toSafePageSize(value: unknown, fallback = 20): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback
  }
  return Math.min(parsed, 100)
}

function toCommentDto(comment: any, userDisplayName?: string, currentUserId?: string) {
  const ownerId = String(comment.userId)
  return {
    id: String(comment._id),
    sceneSpotId: String(comment.sceneSpotId),
    userId: ownerId,
    userDisplayName: userDisplayName || '',
    content: String(comment.content || ''),
    status: String(comment.status || 'pending'),
    rejectReason: typeof comment.rejectReason === 'string' ? comment.rejectReason : null,
    isMine: Boolean(currentUserId && ownerId === currentUserId),
    canDelete: Boolean(currentUserId && ownerId === currentUserId),
    reviewedAt: comment.reviewedAt ? new Date(comment.reviewedAt).toISOString() : null,
    createdAt: comment.createdAt ? new Date(comment.createdAt).toISOString() : null,
    updatedAt: comment.updatedAt ? new Date(comment.updatedAt).toISOString() : null,
  }
}

export async function listSceneSpotComments(ctx: Context): Promise<void> {
  const userId = getOptionalUserId(ctx)
  const { id } = ctx.params as { id: string }
  const { page = '1', pageSize = '20' } = ctx.query as { page?: string; pageSize?: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene spot id')
  }

  const exists = await SceneSpotModel.exists({ _id: id })
  if (!exists) {
    ctx.throw(404, 'Scene spot not found')
  }

  const pageNumber = toSafePage(page, 1)
  const size = toSafePageSize(pageSize, 20)
  const skip = (pageNumber - 1) * size

  const baseFilter: Record<string, unknown> = { sceneSpotId: id, status: 'approved' }
  const filter = userId
    ? {
        sceneSpotId: id,
        $or: [{ status: 'approved' }, { userId: new Types.ObjectId(userId) }],
      }
    : baseFilter

  const [total, rows] = await Promise.all([
    SceneSpotCommentModel.countDocuments(filter),
    SceneSpotCommentModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(size)
      .lean()
      .exec(),
  ])

  const userIds = Array.from(new Set(rows.map((row) => String(row.userId))))
  const users = userIds.length
    ? await AppUserModel.find({ _id: { $in: userIds } }, { _id: 1, displayName: 1, username: 1 }).lean().exec()
    : []
  const userMap = new Map<string, string>()
  for (const user of users as Array<{ _id: Types.ObjectId; displayName?: string; username?: string }>) {
    userMap.set(String(user._id), user.displayName || user.username || '匿名用户')
  }

  ctx.body = {
    data: rows.map((row) => toCommentDto(row, userMap.get(String(row.userId)), userId)),
    total,
    page: pageNumber,
    pageSize: size,
  }
}

export async function createSceneSpotComment(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  const { content } = ctx.request.body as { content?: string }

  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene spot id')
  }
  const normalizedContent = typeof content === 'string' ? content.trim() : ''
  if (!normalizedContent) {
    ctx.throw(400, 'Comment content is required')
  }
  if (normalizedContent.length > COMMENT_CONTENT_MAX_LENGTH) {
    ctx.throw(400, `Comment content cannot exceed ${COMMENT_CONTENT_MAX_LENGTH} characters`)
  }

  const exists = await SceneSpotModel.exists({ _id: id })
  if (!exists) {
    ctx.throw(404, 'Scene spot not found')
  }

  const created = await SceneSpotCommentModel.create({
    sceneSpotId: id,
    userId,
    content: normalizedContent,
    status: 'pending',
  })

  const user = await AppUserModel.findById(userId, { _id: 1, displayName: 1, username: 1 }).lean().exec()
  ctx.status = 201
  ctx.body = {
    comment: toCommentDto(created.toObject(), user?.displayName || user?.username || '匿名用户', userId),
  }
}

export async function deleteSceneSpotComment(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id, commentId } = ctx.params as { id: string; commentId: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene spot id')
  }
  if (!Types.ObjectId.isValid(commentId)) {
    ctx.throw(400, 'Invalid comment id')
  }

  const comment = await SceneSpotCommentModel.findOne({ _id: commentId, sceneSpotId: id }).exec()
  if (!comment) {
    ctx.throw(404, 'Comment not found')
  }
  if (String(comment.userId) !== userId) {
    ctx.throw(403, 'You can only delete your own comments')
  }

  await comment.deleteOne()
  ctx.body = {}
}

function buildSceneDto(scene: any) {
  return {
    id: String(scene._id),
    name: scene.name,
    fileUrl: scene.fileUrl,
    fileKey: scene.fileKey,
    fileSize: typeof scene.fileSize === 'number' ? scene.fileSize : 0,
  }
}

export async function downloadScenePackage(ctx: Context): Promise<void> {
  const sceneId = ensureSceneId(ctx)
  const scene = await SceneModel.findById(sceneId).lean().exec()
  if (!scene) {
    ctx.throw(404, 'Scene not found')
  }
  const fileUrl = typeof scene.fileUrl === 'string' ? scene.fileUrl.trim() : ''
  if (!fileUrl) {
    ctx.throw(404, 'Scene package not found')
  }

  ctx.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0')
  ctx.set('Pragma', 'no-cache')
  ctx.set('Expires', '0')
  ctx.redirect(fileUrl)
}

function buildSceneSpotSummaryDto(spot: any, scene: any) {
  return {
    id: String(spot._id),
    sceneId: String(spot.sceneId),
    title: spot.title,
    coverImage: toStringValue(spot.coverImage, ''),
    description: toStringValue(spot.description, ''),
    address: toStringValue(spot.address, ''),
    distance: toStringValue(spot.distance, ''),
    slides: Array.isArray(spot.slides) ? spot.slides.map((item: unknown) => String(item)) : [],
    order: typeof spot.order === 'number' ? spot.order : 0,
    isHome: spot.isHome === true,
    isFeatured: spot.isFeatured === true,
    isHot: spot.isHot === true,
    averageRating: typeof spot.averageRating === 'number' ? spot.averageRating : 0,
    ratingCount: typeof spot.ratingCount === 'number' ? spot.ratingCount : 0,
    favoriteCount: typeof spot.favoriteCount === 'number' ? spot.favoriteCount : 0,
    phone: toStringValue(spot.phone, ''),
    location:
      spot && spot.location && Array.isArray(spot.location.coordinates) && spot.location.coordinates.length === 2
        ? { lat: Number(spot.location.coordinates[1]), lng: Number(spot.location.coordinates[0]) }
        : null,
    favorited: false,
    userRating: null,
    scene: buildSceneDto(scene),
  }
}

type SceneSpotInteractionLean = {
  sceneSpotId: Types.ObjectId
  favorited?: boolean
  rating?: number | null
}

function withInteractionState(
  dto: ReturnType<typeof buildSceneSpotSummaryDto>,
  interaction?: SceneSpotInteractionLean | null,
) {
  return {
    ...dto,
    favorited: interaction?.favorited === true,
    userRating: typeof interaction?.rating === 'number' ? interaction.rating : null,
  }
}

function toOptionalBoolean(value: unknown): boolean | undefined {
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

  return undefined
}

export async function listHomepageSceneSpots(ctx: Context): Promise<void> {
  const userId = getOptionalUserId(ctx)
  const { q } = ctx.query as { q?: string }

  // fetch featured & hot spot entries with their sceneSpot populated
  const [featuredRows, hotRows, otherSpots] = await Promise.all([
    FeaturedSpotModel.find({}).sort({ order: 1, createdAt: -1 }).populate('sceneSpotId').lean().exec(),
    HotSpotModel.find({}).sort({ order: 1, createdAt: -1 }).populate('sceneSpotId').lean().exec(),
    // only load scene spots that are marked as homepage recommended (isHome)
    SceneSpotModel.find({ isHome: true }).sort({ order: 1, createdAt: -1 }).lean().exec(),
  ])

  const featuredSpots: any[] = []
  const hotSpots: any[] = []
  const otherSpotsMap = new Map<string, any>()

  for (const spot of otherSpots) {
    otherSpotsMap.set(String(spot._id), spot)
  }

  for (const row of featuredRows) {
    const sceneSpot = (row as any).sceneSpotId
    // include only if the referenced scene spot exists and is marked homepage recommended
    if (sceneSpot && (sceneSpot as any).isHome === true)
      featuredSpots.push({ sceneSpot, groupOrder: Number.isFinite(Number(row.order)) ? Number(row.order) : 0 })
  }

  for (const row of hotRows) {
    const sceneSpot = (row as any).sceneSpotId
    // include only if the referenced scene spot exists and is marked homepage recommended
    if (sceneSpot && (sceneSpot as any).isHome === true)
      hotSpots.push({ sceneSpot, groupOrder: Number.isFinite(Number(row.order)) ? Number(row.order) : 0 })
  }

  // remove featured & hot from others map
  for (const f of featuredSpots) otherSpotsMap.delete(String(f.sceneSpot._id))
  for (const h of hotSpots) otherSpotsMap.delete(String(h.sceneSpot._id))

  const others = Array.from(otherSpotsMap.values())

  // optional q filter applied on title/description/address
  const normalizedQ = typeof q === 'string' && q.trim() ? q.trim() : ''

  const matchesQ = (spot: any) => {
    if (!normalizedQ) return true
    const regex = new RegExp(normalizedQ.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'i')
    return regex.test(String(spot.title || '')) || regex.test(String(spot.description || '')) || regex.test(String(spot.address || ''))
  }

  const ordered: any[] = []
  // map of spotId -> homepage tag: 'featured' | 'hot' | 'only'
  const homepageTagById = new Map<string, string>()

  // add featured (ordered by featured.order)
  featuredSpots.sort((a, b) => a.groupOrder - b.groupOrder)
  for (const item of featuredSpots) {
    if (matchesQ(item.sceneSpot)) {
      ordered.push(item.sceneSpot)
      homepageTagById.set(String(item.sceneSpot._id), 'featured')
    }
  }

  // add hot (ordered by hot.order), excluding those already added
  hotSpots.sort((a, b) => a.groupOrder - b.groupOrder)
  const added = new Set(ordered.map((s) => String(s._id)))
  for (const item of hotSpots) {
    const id = String(item.sceneSpot._id)
    if (!added.has(id) && matchesQ(item.sceneSpot)) {
      ordered.push(item.sceneSpot)
      added.add(id)
      homepageTagById.set(id, 'hot')
    }
  }

  // add rest sorted by sceneSpot.order
  others.sort((a, b) => (Number.isFinite(Number(a.order)) ? Number(a.order) : 0) - (Number.isFinite(Number(b.order)) ? Number(b.order) : 0))
  for (const spot of others) {
    const sid = String(spot._id)
    if (!added.has(sid) && matchesQ(spot)) {
      ordered.push(spot)
      homepageTagById.set(sid, 'only')
    }
  }

  // fetch scenes for ordered spots
  const sceneIds = Array.from(new Set(ordered.map((spot) => String(spot.sceneId))))
  const scenes = sceneIds.length ? await SceneModel.find({ _id: { $in: sceneIds } }).lean().exec() : []
  const sceneById = new Map(scenes.map((scene) => [String(scene._id), scene]))

  // gather interaction state
  const spotIds = ordered.map((s) => s._id)
  const interactionBySpotId = new Map<string, SceneSpotInteractionLean>()
  if (userId && spotIds.length) {
    const interactions = await SceneSpotInteractionModel.find({ userId, sceneSpotId: { $in: spotIds } }).lean().exec()
    for (const interaction of interactions as SceneSpotInteractionLean[]) {
      interactionBySpotId.set(String(interaction.sceneSpotId), interaction)
    }
  }

  const rowsDto = ordered
    .map((spot) => {
      const scene = sceneById.get(String(spot.sceneId))
      if (!scene) return null
      const dto = buildSceneSpotSummaryDto(spot, scene)
      // annotate which homepage bucket this spot came from
      const tag = homepageTagById.get(String(spot._id))
      if (tag) (dto as any).homepageTag = tag
      return withInteractionState(dto, interactionBySpotId.get(String(spot._id)))
    })
    .filter(Boolean)

  ctx.body = {
    total: rowsDto.length,
    sceneSpots: rowsDto,
  }
}


type ProductWithStateDto = {
  id: string
  slug: string
  name: string
  coverUrl: string
  price: number
  validityDays?: number | null
  applicableSceneTags: string[]
  owned: boolean
  state: string
  expiresAt?: string | null
  usedAt?: string | null
  locked?: boolean
}

function buildProductDto(product: ProductDocument, userEntry: { state: string; expiresAt?: Date | null; usedAt?: Date | null } | null, owned: boolean): ProductWithStateDto {
  const now = new Date()
  const computedState = computeUserProductState(userEntry as any, now)
  const locked = (product.metadata as any)?.locked === true

  return {
    id: objectIdString(product._id),
    slug: product.slug,
    name: product.name,
    coverUrl: asString(product.coverUrl, ''),
    price: product.price ?? 0,
    validityDays: product.validityDays ?? null,
    applicableSceneTags: Array.isArray(product.applicableSceneTags) ? product.applicableSceneTags : [],
    owned,
    state: computedState,
    expiresAt: userEntry?.expiresAt ? userEntry.expiresAt.toISOString() : null,
    usedAt: userEntry?.usedAt ? userEntry.usedAt.toISOString() : null,
    locked: locked ? true : undefined,
  }
}

export async function listSceneSpots(ctx: Context): Promise<void> {
  const userId = getOptionalUserId(ctx)
  const { q, featured } = ctx.query as { featured?: string; q?: string }
  const filter: Record<string, unknown> = {}
  const featuredFlag = toOptionalBoolean(featured)
  if (featuredFlag !== undefined) {
    filter.isHome = featuredFlag
  }

  if (typeof q === 'string' && q.trim()) {
    const regex = new RegExp(q.trim(), 'i')
    filter.$or = [{ title: regex }, { description: regex }, { address: regex }]
  }

  const spots = await SceneSpotModel.find(filter).sort({ order: 1, createdAt: -1 }).lean().exec()
  const spotIds = spots.map((spot) => spot._id)
  const sceneIds = Array.from(new Set(spots.map((spot) => String(spot.sceneId))))
  const scenes = sceneIds.length ? await SceneModel.find({ _id: { $in: sceneIds } }).lean().exec() : []
  const sceneById = new Map(scenes.map((scene) => [String(scene._id), scene]))
  const interactionBySpotId = new Map<string, SceneSpotInteractionLean>()

  if (userId && spotIds.length) {
    const interactions = await SceneSpotInteractionModel.find({
      userId,
      sceneSpotId: { $in: spotIds },
    })
      .lean()
      .exec()
    for (const interaction of interactions as SceneSpotInteractionLean[]) {
      interactionBySpotId.set(String(interaction.sceneSpotId), interaction)
    }
  }

  const rows = spots
    .map((spot) => {
      const scene = sceneById.get(String(spot.sceneId))
      if (!scene) {
        return null
      }
      const dto = buildSceneSpotSummaryDto(spot, scene)
      return withInteractionState(dto, interactionBySpotId.get(String(spot._id)))
    })
    .filter(Boolean)

  ctx.body = {
    total: rows.length,
    sceneSpots: rows,
  }
}

export async function getSceneSpot(ctx: Context): Promise<void> {
  const userId = getOptionalUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene spot id')
  }

  const spot = await SceneSpotModel.findById(id).lean().exec()
  if (!spot) {
    ctx.throw(404, 'Scene spot not found')
  }

  const scene = await SceneModel.findById(spot.sceneId).lean().exec()
  if (!scene) {
    ctx.throw(404, 'Scene not found')
  }

  const interaction = userId
    ? await SceneSpotInteractionModel.findOne({ sceneSpotId: id, userId }).lean().exec()
    : null

  ctx.body = {
    sceneSpot: withInteractionState(buildSceneSpotSummaryDto(spot, scene), interaction as SceneSpotInteractionLean | null),
  }
}

export async function getSceneSpotEntry(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene spot id')
  }

  const spot = await SceneSpotModel.findById(id).lean().exec()
  if (!spot) {
    ctx.throw(404, 'Scene spot not found')
  }

  const scene = await SceneModel.findById(spot.sceneId).lean().exec()
  if (!scene) {
    ctx.throw(404, 'Scene not found')
  }

  ctx.body = {
    sceneId: String(scene._id),
    sceneSpotId: String(spot._id),
    packageUrl: buildScenePackageDownloadUrl(ctx, String(scene._id)),
    sceneUrl: buildScenePackageDownloadUrl(ctx, String(scene._id)),
  }
}

export async function listSceneProducts(ctx: Context): Promise<void> {
  const userId = getOptionalUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene id')
  }

  const scene = (await SceneModel.findById(id).lean().exec()) as SceneDocument | null
  if (!scene) {
    ctx.throw(404, 'Scene not found')
    return
  }

  const includeApplicable = String((ctx.query as { includeApplicable?: string }).includeApplicable ?? '') === '1'
  const bindings = await SceneProductBindingModel.find({ sceneId: id, enabled: true }).lean().exec()
  const boundProductIds = bindings.map((binding) => binding.productId)
  const sceneTags: string[] = []

  const boundProducts = boundProductIds.length
    ? ((await ProductModel.find({ _id: { $in: boundProductIds } }).lean().exec()) as ProductDocument[])
    : ([] as ProductDocument[])

  const boundProductIdSet = new Set(boundProducts.map((product) => objectIdString(product._id)))
  const applicableProducts = includeApplicable
    ? ((await ProductModel.find({}).lean().exec()) as ProductDocument[]).filter((product) => {
        if (boundProductIdSet.has(objectIdString(product._id))) {
          return false
        }
        return isProductApplicableToScene(product, sceneTags)
      })
    : ([] as ProductDocument[])

  const products = [...boundProducts, ...applicableProducts]

  const userEntriesByProductId = new Map<string, { state: string; expiresAt?: Date | null; usedAt?: Date | null }>()
  if (userId && products.length) {
    const userEntries = await UserProductModel.find({ userId, productId: { $in: products.map((product) => product._id) } }).lean().exec()
    for (const entry of userEntries as any[]) {
      userEntriesByProductId.set(entry.productId.toString(), {
        state: entry.state,
        expiresAt: entry.expiresAt ?? null,
        usedAt: entry.usedAt ?? null,
      })
    }
  }

  const result = products.map((product) => {
    const key = objectIdString(product._id)
    const userEntry = userEntriesByProductId.get(key) ?? null
    const owned = Boolean(userEntry)
    return buildProductDto(product, userEntry, owned)
  })

  ctx.body = {
    total: result.length,
    products: result,
    sceneTags,
  }
}

export async function toggleSceneSpotFavorite(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene spot id')
  }

  const spot = await SceneSpotModel.findById(id).exec()
  if (!spot) {
    ctx.throw(404, 'Scene spot not found')
  }

  const interaction = await SceneSpotInteractionModel.findOne({ sceneSpotId: id, userId }).exec()
  const currentlyFavorited = interaction?.favorited === true
  const nextFavorited = !currentlyFavorited

  if (interaction) {
    interaction.favorited = nextFavorited
    await interaction.save()
  } else {
    await SceneSpotInteractionModel.create({
      sceneSpotId: id,
      userId,
      favorited: nextFavorited,
      rating: null,
    })
  }

  const delta = nextFavorited ? 1 : -1
  const currentFavoriteCount = typeof spot.favoriteCount === 'number' ? spot.favoriteCount : 0
  spot.favoriteCount = Math.max(0, currentFavoriteCount + delta)
  await spot.save()

  ctx.body = {
    favorited: nextFavorited,
    favoriteCount: spot.favoriteCount,
    averageRating: typeof spot.averageRating === 'number' ? spot.averageRating : 0,
    ratingCount: typeof spot.ratingCount === 'number' ? spot.ratingCount : 0,
    userRating: typeof interaction?.rating === 'number' ? interaction.rating : null,
  }
}

export async function rateSceneSpot(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  const { score } = ctx.request.body as { score?: number }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scene spot id')
  }
  if (typeof score !== 'number' || Number.isNaN(score) || !Number.isInteger(score) || score < 1 || score > 5) {
    ctx.throw(400, 'Score must be an integer between 1 and 5')
  }

  const spot = await SceneSpotModel.findById(id).exec()
  if (!spot) {
    ctx.throw(404, 'Scene spot not found')
  }

  const interaction = await SceneSpotInteractionModel.findOne({ sceneSpotId: id, userId }).exec()
  const previousScore = typeof interaction?.rating === 'number' ? interaction.rating : null

  if (interaction) {
    interaction.rating = score
    await interaction.save()
  } else {
    await SceneSpotInteractionModel.create({
      sceneSpotId: id,
      userId,
      favorited: false,
      rating: score,
    })
  }

  const currentRatingCount = typeof spot.ratingCount === 'number' ? spot.ratingCount : 0
  const currentTotalScore = typeof spot.ratingTotalScore === 'number' ? spot.ratingTotalScore : 0
  const nextRatingCount = previousScore === null ? currentRatingCount + 1 : currentRatingCount
  const nextTotalScore = currentTotalScore + score - (previousScore ?? 0)

  spot.ratingCount = Math.max(0, nextRatingCount)
  spot.ratingTotalScore = Math.max(0, Number(nextTotalScore.toFixed(2)))
  spot.averageRating =
    spot.ratingCount > 0 ? Number((spot.ratingTotalScore / spot.ratingCount).toFixed(2)) : 0
  await spot.save()

  ctx.body = {
    averageRating: spot.averageRating,
    ratingCount: spot.ratingCount,
    favoriteCount: typeof spot.favoriteCount === 'number' ? spot.favoriteCount : 0,
    favorited: interaction?.favorited === true,
    userRating: score,
  }
}
