import type { Context } from 'koa'
import { Types } from 'mongoose'
import { OrderModel } from '@/models/Order'
import { UserModel } from '@/models/User'
import { ProductModel } from '@/models/Product'

const ORDER_STATUS = new Set(['pending', 'paid', 'completed', 'cancelled'])

type OrderPayload = {
  orderNumber?: string
  userId?: string
  status?: 'pending' | 'paid' | 'completed' | 'cancelled'
  paymentMethod?: string
  shippingAddress?: string
  scenicId?: string | null
  couponId?: string | null
  metadata?: Record<string, unknown> | null
  items?: Array<{
    productId: string
    name?: string
    price?: number
    quantity?: number
  }>
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function toNumberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

function validObjectId(value: unknown): value is string {
  return typeof value === 'string' && Types.ObjectId.isValid(value)
}

async function buildRelationMap(orders: any[]) {
  const userIds = new Set<string>()
  const productIds = new Set<string>()
  orders.forEach((order) => {
    userIds.add(order.userId.toString())
    ;(order.items ?? []).forEach((item: any) => {
      if (item.productId) {
        productIds.add(item.productId.toString())
      }
    })
  })
  const [users, products] = await Promise.all([
    userIds.size ? UserModel.find({ _id: { $in: Array.from(userIds) } }).lean().exec() : Promise.resolve([]),
    productIds.size ? ProductModel.find({ _id: { $in: Array.from(productIds) } }).lean().exec() : Promise.resolve([]),
  ])
  return {
    users: new Map(users.map((item: any) => [item._id.toString(), item])),
    products: new Map(products.map((item: any) => [item._id.toString(), item])),
  }
}

function mapOrder(order: any, relationMap: { users: Map<string, any>; products: Map<string, any> }) {
  const user = relationMap.users.get(order.userId.toString())
  const metadata = (order.metadata ?? {}) as Record<string, unknown>
  return {
    id: order._id.toString(),
    orderNumber: order.orderNumber,
    status: order.status,
    totalAmount: order.totalAmount,
    paymentMethod: order.paymentMethod ?? null,
    shippingAddress: order.shippingAddress ?? null,
    userInfo: user
      ? {
          id: user._id.toString(),
          username: user.username,
          displayName: user.displayName ?? null,
        }
      : null,
    scenicInfo: metadata.scenicId ? { scenicId: metadata.scenicId } : null,
    couponInfo: metadata.couponId ? { couponId: metadata.couponId } : null,
    items: (order.items ?? []).map((item: any) => {
      const product = relationMap.products.get(item.productId.toString())
      return {
        productId: item.productId.toString(),
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        productInfo: product
          ? {
              id: product._id.toString(),
              name: product.name,
              category: product.category,
            }
          : null,
      }
    }),
    metadata,
    createdAt: order.createdAt?.toISOString?.() ?? new Date(order.createdAt).toISOString(),
    updatedAt: order.updatedAt?.toISOString?.() ?? new Date(order.updatedAt).toISOString(),
  }
}

export async function listOrders(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '10', keyword, status } = ctx.query as Record<string, string>
  const pageNumber = Math.max(Number(page) || 1, 1)
  const limit = Math.min(Math.max(Number(pageSize) || 10, 1), 100)
  const skip = (pageNumber - 1) * limit
  const filter: Record<string, unknown> = {}
  if (keyword && keyword.trim()) {
    filter.orderNumber = new RegExp(keyword.trim(), 'i')
  }
  if (status && ORDER_STATUS.has(status)) {
    filter.status = status
  }
  const [rows, total] = await Promise.all([
    OrderModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
    OrderModel.countDocuments(filter),
  ])
  const relationMap = await buildRelationMap(rows)
  ctx.body = {
    data: rows.map((row: any) => mapOrder(row, relationMap)),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function getOrder(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid order id')
  }
  const row = await OrderModel.findById(id).lean().exec()
  if (!row) {
    ctx.throw(404, 'Order not found')
  }
  const relationMap = await buildRelationMap([row])
  ctx.body = mapOrder(row, relationMap)
}

export async function createOrder(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as OrderPayload
  if (!validObjectId(body.userId)) {
    ctx.throw(400, 'userId is required')
  }
  const orderNumber = toStringValue(body.orderNumber) ?? `ADM${Date.now()}`
  const status = body.status ?? 'pending'
  if (!ORDER_STATUS.has(status)) {
    ctx.throw(400, 'Invalid order status')
  }
  if (!Array.isArray(body.items) || !body.items.length) {
    ctx.throw(400, 'Order items are required')
  }
  const items = body.items.map((item) => {
    if (!validObjectId(item.productId)) {
      ctx.throw(400, 'Invalid productId in items')
    }
    const quantity = Math.max(Math.floor(toNumberValue(item.quantity) ?? 1), 1)
    const price = toNumberValue(item.price) ?? 0
    return {
      productId: new Types.ObjectId(item.productId),
      name: toStringValue(item.name) ?? '',
      price,
      quantity,
    }
  })
  const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const metadata: Record<string, unknown> = { ...(body.metadata ?? {}) }
  if (body.scenicId) {
    metadata.scenicId = body.scenicId
  }
  if (body.couponId) {
    metadata.couponId = body.couponId
  }
  const created = await OrderModel.create({
    userId: new Types.ObjectId(body.userId),
    orderNumber,
    status,
    totalAmount,
    paymentMethod: toStringValue(body.paymentMethod) ?? undefined,
    shippingAddress: toStringValue(body.shippingAddress) ?? undefined,
    items,
    metadata,
  })
  const row = await OrderModel.findById(created._id).lean().exec()
  const relationMap = await buildRelationMap([row])
  ctx.status = 201
  ctx.body = mapOrder(row, relationMap)
}

export async function updateOrder(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid order id')
  }
  const current = await OrderModel.findById(id).lean().exec()
  if (!current) {
    ctx.throw(404, 'Order not found')
  }
  const body = (ctx.request.body ?? {}) as OrderPayload
  const nextStatus = body.status ?? current.status
  if (!ORDER_STATUS.has(nextStatus)) {
    ctx.throw(400, 'Invalid order status')
  }
  const nextMetadata: Record<string, unknown> = {
    ...((current.metadata ?? {}) as Record<string, unknown>),
    ...(body.metadata ?? {}),
  }
  if (body.scenicId !== undefined) {
    nextMetadata.scenicId = body.scenicId
  }
  if (body.couponId !== undefined) {
    nextMetadata.couponId = body.couponId
  }
  const updated = await OrderModel.findByIdAndUpdate(
    id,
    {
      status: nextStatus,
      paymentMethod: body.paymentMethod === undefined ? current.paymentMethod : toStringValue(body.paymentMethod),
      shippingAddress:
        body.shippingAddress === undefined ? current.shippingAddress : toStringValue(body.shippingAddress),
      metadata: nextMetadata,
    },
    { new: true },
  )
    .lean()
    .exec()
  const relationMap = await buildRelationMap([updated])
  ctx.body = mapOrder(updated, relationMap)
}

export async function deleteOrder(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid order id')
  }
  await OrderModel.findByIdAndDelete(id).exec()
  ctx.status = 204
}
