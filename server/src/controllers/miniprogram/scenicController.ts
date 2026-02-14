import type { Context } from 'koa'
import { Types } from 'mongoose'
import { SceneModel } from '@/models/Scene'
import { SceneSpotModel } from '@/models/SceneSpot'
import { MiniEventModel } from '@/models/MiniEvent'
import { SceneProductBindingModel } from '@/models/SceneProductBinding'
import { ProductModel } from '@/models/Product'
import { UserProductModel } from '@/models/UserProduct'
import { getOptionalUserId } from '@/controllers/miniprogram/utils'
import {
  asNumber,
  asString,
  asStringArray,
  computeUserProductState,
  getSceneTags,
  isProductApplicableToScene,
  objectIdString,
  pickSceneMetadata,
} from './miniDtoUtils'
import type { ProductDocument, SceneDocument } from '@/types/models'

type ScenicSummaryDto = {
  id: string
  name: string
  summary: string
  coverUrl: string
  rating?: number
  likes?: number
}

type ScenicDetailDto = ScenicSummaryDto & {
  imageUrls: string[]
  address: string
  phone: string
  packageUrl: string
  checkinProgress?: number
  description?: string
}

function buildScenicSummary(scene: SceneDocument): ScenicSummaryDto {
  const meta = pickSceneMetadata(scene)
  const summary = asString(meta.summary, asString(scene.description, ''))
  const coverUrl = asString(meta.coverUrl, '')
  const rating = asNumber(meta.rating)
  const likes = asNumber(meta.likes)

  const dto: ScenicSummaryDto = {
    id: objectIdString(scene._id),
    name: scene.name,
    summary,
    coverUrl,
  }
  if (typeof rating === 'number') {
    dto.rating = rating
  }
  if (typeof likes === 'number') {
    dto.likes = likes
  }
  return dto
}

function buildScenicDetail(scene: SceneDocument): ScenicDetailDto {
  const meta = pickSceneMetadata(scene)
  const base = buildScenicSummary(scene)
  const imageUrls = asStringArray(meta.imageUrls)
  const address = asString(meta.address, '')
  const phone = asString(meta.phone, '')
  const packageUrl = asString(meta.packageUrl, scene.fileUrl)
  const description = asString(meta.description, base.summary)
  const checkinProgress = asNumber(meta.checkinProgress)

  const dto: ScenicDetailDto = {
    ...base,
    imageUrls,
    address,
    phone,
    packageUrl,
    description,
  }
  if (typeof checkinProgress === 'number') {
    dto.checkinProgress = checkinProgress
  }
  return dto
}

export async function listScenics(ctx: Context): Promise<void> {
  const { q } = ctx.query as { q?: string }
  const filter: Record<string, unknown> = {}
  if (q && typeof q === 'string' && q.trim()) {
    filter.name = { $regex: q.trim(), $options: 'i' }
  }
  const scenes = (await SceneModel.find(filter).sort({ createdAt: -1 }).lean().exec()) as SceneDocument[]
  ctx.body = {
    total: scenes.length,
    scenics: scenes.map(buildScenicSummary),
  }
}

export async function getScenic(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scenic id')
  }

  const scene = (await SceneModel.findById(id).lean().exec()) as SceneDocument | null
  if (!scene) {
    ctx.throw(404, 'Scenic not found')
    return
  }

  const spots = await SceneSpotModel.find({ sceneId: id }).sort({ order: 1, createdAt: 1 }).lean().exec()
  const events = await MiniEventModel.find({ sceneId: id }).sort({ hotScore: -1, startAt: 1 }).lean().exec()

  ctx.body = {
    scenic: buildScenicDetail(scene),
    spots: spots.map((spot) => ({
      id: objectIdString(spot._id),
      title: spot.title,
      summary: asString(spot.summary, ''),
      coverUrl: asString(spot.coverUrl, ''),
      anchor: spot.anchor ?? null,
      order: spot.order ?? 0,
    })),
    events: events.map((event) => ({
      id: objectIdString(event._id),
      title: event.title,
      description: asString(event.description, ''),
      coverUrl: asString(event.coverUrl, ''),
      locationText: event.locationText ?? null,
      startAt: event.startAt ? event.startAt.toISOString() : null,
      endAt: event.endAt ? event.endAt.toISOString() : null,
      hotScore: event.hotScore ?? 0,
    })),
  }
}

export async function getScenicEntry(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scenic id')
  }

  const scene = (await SceneModel.findById(id).lean().exec()) as SceneDocument | null
  if (!scene) {
    ctx.throw(404, 'Scenic not found')
    return
  }

  const meta = pickSceneMetadata(scene)
  const packageUrl = asString(meta.packageUrl, scene.fileUrl)

  ctx.body = {
    projectId: null,
    packageUrl,
    sceneUrl: packageUrl,
  }
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

export async function listScenicProducts(ctx: Context): Promise<void> {
  const userId = getOptionalUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid scenic id')
  }

  const scene = (await SceneModel.findById(id).lean().exec()) as SceneDocument | null
  if (!scene) {
    ctx.throw(404, 'Scenic not found')
    return
  }

  const includeApplicable = String((ctx.query as { includeApplicable?: string }).includeApplicable ?? '') === '1'

  const bindings = await SceneProductBindingModel.find({ sceneId: id, enabled: true }).lean().exec()
  const boundProductIds = bindings.map((binding) => binding.productId)

  const meta = pickSceneMetadata(scene)
  const sceneTags = getSceneTags(meta)

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
