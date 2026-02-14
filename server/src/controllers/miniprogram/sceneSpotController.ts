import type { Context } from 'koa'
import { Types } from 'mongoose'
import { SceneModel } from '@/models/Scene'
import { SceneSpotModel } from '@/models/SceneSpot'
import { SceneProductBindingModel } from '@/models/SceneProductBinding'
import { ProductModel } from '@/models/Product'
import { UserProductModel } from '@/models/UserProduct'
import { getOptionalUserId } from '@/controllers/miniprogram/utils'
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
    scene: buildSceneDto(scene),
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
  const sceneIds = Array.from(new Set(spots.map((spot) => String(spot.sceneId))))
  const scenes = sceneIds.length ? await SceneModel.find({ _id: { $in: sceneIds } }).lean().exec() : []
  const sceneById = new Map(scenes.map((scene) => [String(scene._id), scene]))

  const rows = spots
    .map((spot) => {
      const scene = sceneById.get(String(spot.sceneId))
      if (!scene) {
        return null
      }
      return buildSceneSpotSummaryDto(spot, scene)
    })
    .filter(Boolean)

  ctx.body = {
    total: rows.length,
    sceneSpots: rows,
  }
}

export async function getSceneSpot(ctx: Context): Promise<void> {
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
    sceneSpot: buildSceneSpotSummaryDto(spot, scene),
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
