import type { Context } from 'koa'
import { Types } from 'mongoose'
import { SceneModel } from '@/models/Scene'
import { SceneSpotModel } from '@/models/SceneSpot'
import { SceneSpotInteractionModel } from '@/models/SceneSpotInteraction'
import { SceneProductBindingModel } from '@/models/SceneProductBinding'
import { ProductModel } from '@/models/Product'
import { UserProductModel } from '@/models/UserProduct'
import { ensureUserId, getOptionalUserId } from '@/controllers/miniprogram/utils'
import {
  asString,
  computeUserProductState,
  isProductApplicableToScene,
  objectIdString,
} from './miniDtoUtils'
import type { ProductDocument, SceneDocument } from '@/types/models'

function toStringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
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

function buildSceneSpotSummaryDto(spot: any, scene: any) {
  return {
    id: String(spot._id),
    sceneId: String(spot.sceneId),
    title: spot.title,
    coverImage: toStringValue(spot.coverImage, ''),
    description: toStringValue(spot.description, ''),
    address: toStringValue(spot.address, ''),
    slides: Array.isArray(spot.slides) ? spot.slides.map((item: unknown) => String(item)) : [],
    order: typeof spot.order === 'number' ? spot.order : 0,
    isFeatured: spot.isFeatured === true,
    averageRating: typeof spot.averageRating === 'number' ? spot.averageRating : 0,
    ratingCount: typeof spot.ratingCount === 'number' ? spot.ratingCount : 0,
    favoriteCount: typeof spot.favoriteCount === 'number' ? spot.favoriteCount : 0,
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

type ProductWithStateDto = {
  id: string
  slug: string
  name: string
  category: string
  summary: string
  coverUrl: string
  imageUrl?: string
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
    category: product.category,
    summary: asString(product.summary, ''),
    coverUrl: asString(product.coverUrl, ''),
    imageUrl: product.imageUrl ?? undefined,
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
    filter.isFeatured = featuredFlag
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
    packageUrl: scene.fileUrl,
    sceneUrl: scene.fileUrl,
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
