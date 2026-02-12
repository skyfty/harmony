import type { Context } from 'koa'
import { Types } from 'mongoose'
import { ProductModel } from '@/models/Product'
import { OrderModel } from '@/models/Order'
import { UserProductModel } from '@/models/UserProduct'
import { ensureUserId, getOptionalUserId } from './utils'
import { generateOrderNumber } from '@/utils/orderNumber'
import type { ProductUsageConfig, UserProductState } from '@/types/models'
import { processProductPayment } from '@/services/paymentService'
import { addProductToWarehouse } from '@/services/warehouseService'

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
  name: string
  category: string
  price: number
  imageUrl?: string
  coverUrl?: string
  summary?: string
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
}

interface PurchaseBody {
  paymentMethod?: string
  shippingAddress?: string
  metadata?: Record<string, unknown>
}

interface ProductLean {
  _id: Types.ObjectId
  slug: string
  name: string
  category: string
  price: number
  imageUrl?: string
  coverUrl?: string | null
  summary?: string | null
  description?: string
  tags?: string[]
  usageConfig?: ProductUsageConfig | null
  validityDays?: number | null
  applicableSceneTags?: string[]
  metadata?: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

function buildProductResponse(product: ProductLean, userEntry?: {
  acquiredAt: Date
  state: UserProductState
  expiresAt?: Date | null
  usedAt?: Date | null
} | null): ProductResponse {
  const purchased = Boolean(userEntry)
  const state = computeUserProductState(userEntry ?? null)
  const locked = (product.metadata as any)?.locked === true
  return {
    id: product._id.toString(),
    slug: product.slug,
    name: product.name,
    category: product.category,
    price: product.price,
    imageUrl: product.imageUrl ?? undefined,
    coverUrl: (product.coverUrl ?? undefined) ?? undefined,
    summary: (product.summary ?? undefined) ?? undefined,
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
  }
}

export async function listProducts(ctx: Context): Promise<void> {
  const userId = getOptionalUserId(ctx)
  const { category } = ctx.query as { category?: string }
  const filter: Record<string, unknown> = {}
  if (category) {
    filter.category = category
  }

  const products = (await ProductModel.find(filter).sort({ createdAt: -1 }).lean().exec()) as ProductLean[]

  const entriesByProductId = new Map<string, { acquiredAt: Date; state: UserProductState; expiresAt?: Date | null; usedAt?: Date | null }>()
  if (userId && products.length) {
    const entries = await UserProductModel.find({ userId, productId: { $in: products.map((product) => product._id) } })
      .lean()
      .exec()
    for (const entry of entries as any[]) {
      entriesByProductId.set(entry.productId.toString(), {
        acquiredAt: entry.acquiredAt,
        state: entry.state,
        expiresAt: entry.expiresAt ?? null,
        usedAt: entry.usedAt ?? null,
      })
    }
  }
  ctx.body = {
    total: products.length,
    products: products.map((product: ProductLean) => buildProductResponse(product, entriesByProductId.get(product._id.toString()) ?? null)),
  }
}

export async function getProduct(ctx: Context): Promise<void> {
  const userId = getOptionalUserId(ctx)
  const { id } = ctx.params as { id: string }
  const product = (await ProductModel.findById(id).lean().exec()) as ProductLean | null
  if (!product) {
    ctx.throw(404, 'Product not found')
    return
  }

  let userEntry: any | null = null
  if (userId) {
    userEntry = await UserProductModel.findOne({ userId, productId: product._id }).lean().exec()
  }
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
  )
}

export async function purchaseProduct(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  const { paymentMethod, shippingAddress, metadata } = ctx.request.body as PurchaseBody
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid product id')
  }
  const product = await ProductModel.findById(id).exec()
  if (!product) {
    ctx.throw(404, 'Product not found')
    return
  }

  const now = new Date()
  const existing = await UserProductModel.findOne({ userId, productId: product._id }).exec()
  if (existing) {
    const expired = existing.expiresAt ? existing.expiresAt.getTime() <= now.getTime() : false
    if (!expired) {
      ctx.throw(400, 'Product already owned')
    }
  }

  const paymentResult = await processProductPayment({
    userId,
    productId: product._id.toString(),
    productName: product.name,
    amount: product.price,
    method: paymentMethod,
    metadata,
  })

  if (paymentResult.status !== 'success') {
    const message = paymentResult.message ?? '支付失败，请稍后重试'
    ctx.throw(402, message)
  }

  const paymentInfo: Record<string, unknown> = {
    provider: paymentResult.provider,
    status: paymentResult.status,
  }

  if (paymentResult.transactionId) {
    paymentInfo.transactionId = paymentResult.transactionId
  }
  if (paymentResult.raw) {
    paymentInfo.raw = paymentResult.raw
  }

  const orderMetadata: Record<string, unknown> = metadata ? { ...metadata } : {}
  orderMetadata.payment = paymentInfo

  const orderNumber = generateOrderNumber()
  const order = await OrderModel.create({
    userId,
    orderNumber,
    status: 'paid',
    totalAmount: product.price,
    paymentMethod: paymentMethod ?? paymentResult.provider,
    shippingAddress,
    items: [
      {
        productId: product._id,
        name: product.name,
        price: product.price,
        quantity: 1,
      },
    ],
    metadata: orderMetadata,
  })

  const expiresAt = product.validityDays ? new Date(now.getTime() + product.validityDays * 86400000) : null
  await UserProductModel.updateOne(
    { userId, productId: product._id },
    {
      $setOnInsert: {
        userId: new Types.ObjectId(userId),
        productId: product._id,
        acquiredAt: now,
      },
      $set: {
        state: 'unused',
        usedAt: null,
        expiresAt,
        orderId: order._id,
        metadata: metadata ?? null,
        acquiredAt: now,
      },
    },
    { upsert: true },
  ).exec()

  await addProductToWarehouse({ userId, product: product.toObject() as any, orderId: order._id })
  ctx.status = 201
  ctx.body = {
    order: {
      id: order._id.toString(),
      orderNumber: order.orderNumber,
      status: order.status,
      totalAmount: order.totalAmount,
      paymentMethod: order.paymentMethod ?? undefined,
      shippingAddress: order.shippingAddress ?? undefined,
      createdAt: order.createdAt.toISOString(),
    },
    product: buildProductResponse(product.toObject() as ProductLean, {
      acquiredAt: now,
      state: 'unused',
      expiresAt,
      usedAt: null,
    }),
  }
}
