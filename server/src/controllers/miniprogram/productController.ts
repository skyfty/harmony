import type { Context } from 'koa'
import { Types } from 'mongoose'
import { OptimizeProductModel } from '@/models/OptimizeProduct'
import { OrderModel } from '@/models/Order'
import { ensureUserId } from './utils'
import { OPTIMIZE_PRODUCT_SEEDS } from '@/data/optimizeProducts'
import { generateOrderNumber } from '@/utils/orderNumber'

interface ProductResponse {
  id: string
  slug: string
  name: string
  category: string
  price: number
  imageUrl?: string
  description?: string
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
  purchasedBy: ProductPurchaseEntry[]
  createdAt: Date
  updatedAt: Date
}

async function ensureProductsSeeded(): Promise<void> {
  const count = await OptimizeProductModel.estimatedDocumentCount().exec()
  if (count > 0) {
    return
  }
  const documents = OPTIMIZE_PRODUCT_SEEDS.map((seed) => ({
    name: seed.name,
    slug: seed.slug,
    category: seed.category,
    price: seed.price,
    imageUrl: seed.imageUrl,
    description: seed.description,
  }))
  await OptimizeProductModel.insertMany(documents).catch(() => undefined)
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
    purchased: Boolean(purchasedEntry),
    purchasedAt: purchasedEntry ? purchasedEntry.purchasedAt.toISOString() : undefined,
  }
}

export async function listProducts(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  await ensureProductsSeeded()
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
  await ensureProductsSeeded()
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
  const orderNumber = generateOrderNumber()
  const order = await OrderModel.create({
    userId,
    orderNumber,
    status: 'paid',
    totalAmount: product.price,
    paymentMethod: paymentMethod ?? 'wechat',
    shippingAddress,
    items: [
      {
        productId: product._id,
        name: product.name,
        price: product.price,
        quantity: 1,
      },
    ],
    metadata,
  })
  product.purchasedBy.push({
    userId: new Types.ObjectId(userId),
    orderId: order._id,
    purchasedAt: new Date(),
  })
  await product.save()
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
