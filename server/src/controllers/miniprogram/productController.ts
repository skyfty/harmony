import type { Context } from 'koa'
import { Types } from 'mongoose'
import { OptimizeProductModel } from '@/models/OptimizeProduct'
import { OrderModel } from '@/models/Order'
import { ensureUserId } from './utils'
import { generateOrderNumber } from '@/utils/orderNumber'
import type { OptimizeProductUsageConfig } from '@/types/models'
import { processProductPayment } from '@/services/paymentService'
import { addProductToWarehouse } from '@/services/warehouseService'

interface ProductResponse {
  id: string
  slug: string
  name: string
  category: string
  price: number
  imageUrl?: string
  description?: string
  tags?: string[]
  usageConfig?: OptimizeProductUsageConfig
  purchased: boolean
  purchasedAt?: string
}

interface PurchaseBody {
  paymentMethod?: string
  shippingAddress?: string
  metadata?: Record<string, unknown>
}

interface ProductPurchaseEntry {
  userId: Types.ObjectId
  orderId?: Types.ObjectId
  purchasedAt: Date
}

interface ProductLean {
  _id: Types.ObjectId
  slug: string
  name: string
  category: string
  price: number
  imageUrl?: string
  description?: string
  tags?: string[]
  usageConfig?: OptimizeProductUsageConfig | null
  purchasedBy: ProductPurchaseEntry[]
  createdAt: Date
  updatedAt: Date
}

function buildProductResponse(product: ProductLean, userId?: string): ProductResponse {
  const purchasedEntry = Array.isArray(product.purchasedBy)
    ? product.purchasedBy.find((entry: ProductPurchaseEntry) => entry.userId.toString() === userId)
    : undefined
  return {
    id: product._id.toString(),
    slug: product.slug,
    name: product.name,
    category: product.category,
    price: product.price,
    imageUrl: product.imageUrl ?? undefined,
    description: product.description ?? undefined,
    tags: Array.isArray(product.tags) ? product.tags : [],
    usageConfig: product.usageConfig ?? undefined,
    purchased: Boolean(purchasedEntry),
    purchasedAt: purchasedEntry ? purchasedEntry.purchasedAt.toISOString() : undefined,
  }
}

export async function listProducts(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { category } = ctx.query as { category?: string }
  const filter: Record<string, unknown> = {}
  if (category) {
    filter.category = category
  }
  const products = (await OptimizeProductModel.find(filter).sort({ createdAt: -1 }).lean().exec()) as ProductLean[]
  ctx.body = {
    total: products.length,
    products: products.map((product: ProductLean) => buildProductResponse(product, userId)),
  }
}

export async function getProduct(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  const product = (await OptimizeProductModel.findById(id).lean().exec()) as ProductLean | null
  if (!product) {
    ctx.throw(404, 'Product not found')
    return
  }
  ctx.body = buildProductResponse(product, userId)
}

export async function purchaseProduct(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  const { paymentMethod, shippingAddress, metadata } = ctx.request.body as PurchaseBody
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid product id')
  }
  const product = await OptimizeProductModel.findById(id).exec()
  if (!product) {
    ctx.throw(404, 'Product not found')
    return
  }
  const alreadyPurchased = product.purchasedBy.some((entry: ProductPurchaseEntry) => entry.userId.toString() === userId)
  if (alreadyPurchased) {
    ctx.throw(400, 'Product already purchased')
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
  product.purchasedBy.push({
    userId: new Types.ObjectId(userId),
    orderId: order._id,
    purchasedAt: new Date(),
  })
  await product.save()
  await addProductToWarehouse({ userId, product, orderId: order._id })
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
    product: buildProductResponse(product.toObject() as ProductLean, userId),
  }
}
