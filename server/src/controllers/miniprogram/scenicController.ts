import type { Context } from 'koa'
import { Types } from 'mongoose'
import { SceneModel } from '@/models/Scene'
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

export async function listScenicProducts(ctx: Context): Promise<void> {
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
