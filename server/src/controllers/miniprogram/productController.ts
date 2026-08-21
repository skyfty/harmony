import type { Context } from 'koa'
import { Types } from 'mongoose'
import { ProductModel } from '@/models/Product'
import { OrderModel } from '@/models/Order'
import { UserProductModel } from '@/models/UserProduct'
import { UserControllableSelectionModel } from '@/models/UserControllableSelection'
import { ensureMiniCheckoutUser, ensureUserId, getOptionalUserId } from './utils'
import { generateOrderNumber } from '@/utils/orderNumber'
import type { ProductUsageConfig, UserProductState } from '@/types/models'
import { getMiniPlatformPaymentProvider } from '@/services/miniPlatformProviders'
import { ControllableAssetModel } from '@/models/ControllableAsset'
import { SkinModel } from '@/models/Skin'
import { SkinCategoryModel } from '@/models/SkinCategory'
import { UserSkinSelectionModel } from '@/models/UserSkinSelection'
import { ProductCategoryModel } from '@/models/ProductCategory'

function computeUserProductState(entry: {
  state?: UserProductState
  expiresAt?: Date | null
  usedAt?: Date | null
} | null, now = new Date()): UserProductState {
  if (!entry) {
    return 'unused'
  }
  const expiresAt = entry.expiresAt ?? null
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return 'expired'
  }
  if (entry.usedAt) {
    return 'used'
  }
  if (entry.state === 'locked' || entry.state === 'used' || entry.state === 'expired') {
    return entry.state
  }
  return 'unused'
}

interface ProductResponse {
  id: string
  slug: string
  categoryId?: string | null
  name: string
  price: number
  coverUrl?: string
  description?: string
  tags?: string[]
  usageConfig?: ProductUsageConfig
  locked?: boolean
  validityDays?: number | null
  applicableSceneTags?: string[]
  purchased: boolean
  purchasedAt?: string
  state?: UserProductState
  expiresAt?: string | null
  usedAt?: string | null
  controllableAsset?: {
    id: string
    identifier: string
    name: string
    type: string
    prefabUrl?: string
    isDefault?: boolean
    selected?: boolean
  } | null
  skin?: {
    id: string
    identifier: string
    name: string
    categoryId: string | null
    categoryName: string | null
    slotKey: string | null
    prefabUrl?: string
    selected?: boolean
  } | null
}

interface PurchaseBody {
  paymentMethod?: string
  shippingAddress?: string
  metadata?: Record<string, unknown>
}

interface ProductLean {
  _id: Types.ObjectId
  slug: string
  categoryId?: Types.ObjectId | null
  name: string
  price: number
  coverUrl?: string | null
  description?: string
  tags?: string[]
  usageConfig?: ProductUsageConfig | null
  validityDays?: number | null
  applicableSceneTags?: string[]
  metadata?: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
  controllableAssetId?: Types.ObjectId | null
  controllableType?: string | null
  skinId?: Types.ObjectId | null
}

function buildProductResponse(product: ProductLean, userEntry?: {
  acquiredAt: Date
  state: UserProductState
  expiresAt?: Date | null
  usedAt?: Date | null
} | null, controllableAsset?: any | null, selected = false, skin?: any | null, skinSelected = false): ProductResponse {
  const purchased = Boolean(userEntry)
  const state = computeUserProductState(userEntry ?? null)
  const locked = (product.metadata as any)?.locked === true
  return {
    id: product._id.toString(),
    slug: product.slug,
    categoryId: product.categoryId?.toString?.() ?? null,
    name: product.name,
    price: product.price,
    coverUrl: (product.coverUrl ?? undefined) ?? undefined,
    description: product.description ?? undefined,
    tags: Array.isArray(product.tags) ? product.tags : [],
    usageConfig: product.usageConfig ?? undefined,
    locked: locked ? true : undefined,
    validityDays: product.validityDays ?? null,
    applicableSceneTags: Array.isArray(product.applicableSceneTags) ? product.applicableSceneTags : [],
    purchased,
    purchasedAt: userEntry ? userEntry.acquiredAt.toISOString() : undefined,
    state: userEntry ? state : undefined,
    expiresAt: userEntry?.expiresAt ? userEntry.expiresAt.toISOString() : null,
    usedAt: userEntry?.usedAt ? userEntry.usedAt.toISOString() : null,
    controllableAsset: controllableAsset
      ? {
          id: controllableAsset._id.toString(),
          identifier: String(controllableAsset.identifier ?? ''),
          name: controllableAsset.name ?? '',
          type: controllableAsset.type,
          prefabUrl: controllableAsset.prefabUrl ?? '',
          isDefault: controllableAsset.isDefault === true,
          selected,
        }
      : null,
    skin: skin
      ? {
          id: skin._id.toString(),
          identifier: String(skin.identifier ?? ''),
          name: skin.name ?? '',
          categoryId: skin.categoryId?.toString?.() ?? null,
          categoryName: skin.category?.name ?? null,
          slotKey: skin.category?.slotKey ?? null,
          prefabUrl: skin.prefabUrl ?? '',
          selected: skinSelected,
        }
      : null,
  }
}

export async function listProducts(ctx: Context): Promise<void> {
  const userId = getOptionalUserId(ctx)
  const { keyword, categoryId } = ctx.query as Record<string, string>
  const visibleCategories = await ProductCategoryModel.find({
    enabled: { $ne: false },
    purchasable: { $ne: false },
  })
    .select({ _id: 1 })
    .lean()
    .exec()
  const visibleCategoryIds = visibleCategories.map((row: any) => row._id)
  const filter: Record<string, unknown> = {
    isDeleted: { $ne: true },
    categoryId: { $in: visibleCategoryIds },
  }
  if (keyword?.trim()) {
    const pattern = new RegExp(keyword.trim(), 'i')
    filter.$or = [
      { name: pattern },
      { slug: pattern },
      { description: pattern },
      { tags: pattern },
    ]
  }
  if (categoryId && Types.ObjectId.isValid(categoryId)) {
    const selectedCategoryId = new Types.ObjectId(categoryId)
    if (!visibleCategoryIds.some((row) => row.toString() === selectedCategoryId.toString())) {
      ctx.body = {
        total: 0,
        products: [],
      }
      return
    }
    filter.categoryId = selectedCategoryId
  }

  const products = (await ProductModel.find(filter).sort({ createdAt: -1 }).lean().exec()) as ProductLean[]
  const controllableAssets = await ControllableAssetModel.find({ productId: { $in: products.map((product) => product._id) }, isActive: true }).lean().exec()
  const controllableByProductId = new Map(controllableAssets.map((asset: any) => [asset.productId.toString(), asset]))
  const controllableTypeByProductId = new Map(controllableAssets.map((asset: any) => [asset.productId.toString(), asset.type]))
  const skins = await SkinModel.find({ productId: { $in: products.map((product) => product._id) }, isActive: true }).lean().exec()
  const skinCategoryIds = Array.from(new Set(skins.map((skin: any) => skin.categoryId?.toString?.()).filter(Boolean)))
  const skinCategories = skinCategoryIds.length
    ? await SkinCategoryModel.find({ _id: { $in: skinCategoryIds } }).lean().exec()
    : []
  const skinCategoryById = new Map(skinCategories.map((category: any) => [category._id.toString(), category]))
  const skinByProductId = new Map(skins.map((skin: any) => [skin.productId.toString(), { ...skin, category: skinCategoryById.get(skin.categoryId?.toString?.() ?? '') ?? null }]))

  const entriesByProductId = new Map<string, { acquiredAt: Date; state: UserProductState; expiresAt?: Date | null; usedAt?: Date | null }>()
  const selectedProductIds = new Set<string>()
  const selectedSkinByCategory = new Map<string, string>()
  if (userId && products.length) {
    const [entries, selectedRows] = await Promise.all([
      UserProductModel.find({ userId, productId: { $in: products.map((product) => product._id) } }).lean().exec(),
      UserControllableSelectionModel.find({
        userId,
        controllableType: { $in: Array.from(new Set(controllableAssets.map((asset: any) => asset.type))) },
      })
        .select({ controllableType: 1, controllableAssetId: 1 })
        .lean()
        .exec(),
    ])
    for (const entry of entries as any[]) {
      entriesByProductId.set(entry.productId.toString(), {
        acquiredAt: entry.acquiredAt,
        state: entry.state,
        expiresAt: entry.expiresAt ?? null,
        usedAt: entry.usedAt ?? null,
      })
    }
    const selectedAssetIds = new Set(selectedRows.map((entry: any) => entry.controllableAssetId?.toString?.()).filter(Boolean))
    for (const asset of controllableAssets as any[]) {
      if (selectedAssetIds.has(asset._id.toString())) {
        selectedProductIds.add(asset.productId.toString())
      }
    }
    if (skinCategoryIds.length) {
      const skinSelectionRows = await UserSkinSelectionModel.find({
        userId,
        skinCategoryId: { $in: skinCategoryIds },
      })
        .select({ skinCategoryId: 1, skinId: 1 })
        .lean()
        .exec()
      for (const entry of skinSelectionRows as any[]) {
        selectedSkinByCategory.set(entry.skinCategoryId.toString(), entry.skinId.toString())
      }
    }
  }
  ctx.body = {
    total: products.length,
    products: products.map((product: ProductLean) => {
      const productId = product._id.toString()
      const skin = skinByProductId.get(productId) ?? null
      return buildProductResponse(
        product,
        entriesByProductId.get(productId) ?? null,
        controllableByProductId.get(productId) ?? null,
        selectedProductIds.has(productId),
        skin,
        Boolean(skin && selectedSkinByCategory.get(skin.categoryId?.toString?.() ?? '') === skin._id.toString()),
      )
    }),
  }
}

export async function getProduct(ctx: Context): Promise<void> {
  const userId = getOptionalUserId(ctx)
  const { id } = ctx.params as { id: string }
  const product = (await ProductModel.findOne({ _id: id, isDeleted: { $ne: true } }).lean().exec()) as ProductLean | null
  if (!product) {
    ctx.throw(404, 'Product not found')
    return
  }

  let userEntry: any | null = null
  if (userId) {
    userEntry = await UserProductModel.findOne({ userId, productId: product._id }).lean().exec()
  }
  const controllableAsset = await ControllableAssetModel.findOne({ productId: product._id, isActive: true }).lean().exec()
  const selectedRow = userId && controllableAsset
    ? await UserControllableSelectionModel.findOne({ userId, controllableType: controllableAsset.type, controllableAssetId: controllableAsset._id }).lean().exec()
    : null
  const skin = product?.skinId
    ? await SkinModel.findOne({ _id: product.skinId, productId: product._id, isActive: true }).lean().exec()
    : null
  const skinCategory = skin?.categoryId ? await SkinCategoryModel.findById(skin.categoryId).lean().exec() : null
  const skinSelectedRow = userId && skin
    ? await UserSkinSelectionModel.findOne({ userId, skinCategoryId: skin.categoryId, skinId: skin._id }).lean().exec()
    : null
  ctx.body = buildProductResponse(
    product,
    userEntry
      ? {
          acquiredAt: userEntry.acquiredAt,
          state: userEntry.state,
          expiresAt: userEntry.expiresAt ?? null,
          usedAt: userEntry.usedAt ?? null,
        }
      : null,
    controllableAsset,
    Boolean(selectedRow),
    skin ? { ...skin, category: skinCategory } : null,
    Boolean(skinSelectedRow),
  )
}

export async function listProductCategories(ctx: Context): Promise<void> {
  const rows = await ProductCategoryModel.find({
    enabled: { $ne: false },
    purchasable: { $ne: false },
  })
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean()
    .exec()
  ctx.body = {
    categories: (rows as any[]).map((row) => ({
      id: row._id.toString(),
      name: row.name,
      description: row.description ?? null,
      sortOrder: Number(row.sortOrder) || 0,
      enabled: row.enabled !== false,
      purchasable: row.purchasable !== false,
      isBuiltin: row.isBuiltin === true,
      createdAt: row.createdAt?.toISOString?.() ?? null,
      updatedAt: row.updatedAt?.toISOString?.() ?? null,
    })),
  }
}

export async function purchaseProduct(ctx: Context): Promise<void> {
  const checkoutUser = await ensureMiniCheckoutUser(ctx)
  const userId = checkoutUser.id
  const { id } = ctx.params as { id: string }
  const { paymentMethod, shippingAddress, metadata } = ctx.request.body as PurchaseBody
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid product id')
  }
  const product = await ProductModel.findOne({ _id: id, isDeleted: { $ne: true } }).exec()
  if (!product) {
    ctx.throw(404, 'Product not found')
    return
  }

  const orderMetadata: Record<string, unknown> = metadata ? { ...metadata } : {}
  orderMetadata.source = 'product-purchase'
  const orderNumber = generateOrderNumber()
  const order = await OrderModel.create({
    userId,
    orderNumber,
    status: 'pending',
    orderStatus: 'pending',
    paymentStatus: 'unpaid',
    totalAmount: product.price,
    paymentMethod: paymentMethod ?? checkoutUser.platform ?? 'wechat',
    shippingAddress,
    items: [
      {
        productId: product._id,
        itemType: 'product',
        name: product.name,
        price: product.price,
        quantity: 1,
      },
    ],
    metadata: orderMetadata,
  })

  const paymentPlatform = checkoutUser.platform ?? 'wechat'
  const paymentResult = await getMiniPlatformPaymentProvider(paymentPlatform).createPayment({
    appKey: checkoutUser.appKey,
    orderNumber,
    description: product.name,
    amount: product.price,
    openId: checkoutUser.openId,
    attach: JSON.stringify({ orderId: order._id.toString(), userId, productId: product._id.toString() }),
  })

  order.paymentProvider = paymentResult.provider
  order.paymentStatus = paymentResult.status === 'pending' ? 'processing' : 'failed'
  order.prepayId = paymentResult.prepayId
  order.paymentResult = {
    ...(order.paymentResult ?? {}),
    prepay: paymentResult.raw ?? null,
    requestedAt: new Date().toISOString(),
  }
  await order.save()

  ctx.status = 201
  ctx.body = {
    order: {
      id: order._id.toString(),
      orderNumber: order.orderNumber,
      status: order.orderStatus,
      paymentStatus: order.paymentStatus,
      totalAmount: order.totalAmount,
      paymentMethod: order.paymentMethod ?? undefined,
      shippingAddress: order.shippingAddress ?? undefined,
      createdAt: order.createdAt.toISOString(),
    },
    payParams: paymentResult.payParams,
    product: buildProductResponse(product.toObject() as ProductLean, null),
  }
}
