import type { Context } from 'koa'
import { Types } from 'mongoose'
import { OrderModel } from '@/models/Order'
import { ProductModel } from '@/models/Product'
import { VehicleModel } from '@/models/Vehicle'
import { AppUserModel } from '@/models/AppUser'
import { ensureMiniCheckoutUser, ensureUserId } from './utils'
import { createOrderPayment } from '@/services/paymentService'
import { generateOrderNumber } from '@/utils/orderNumber'

type OrderStatus = 'pending' | 'paid' | 'completed' | 'cancelled'
type PaymentStatus = 'unpaid' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'closed'
type OrderItemType = 'product' | 'prop' | 'equipment' | 'service' | 'other'

const ORDER_STATUS_VALUES: OrderStatus[] = ['pending', 'paid', 'completed', 'cancelled']
const PAYMENT_STATUS_VALUES: PaymentStatus[] = ['unpaid', 'processing', 'succeeded', 'failed', 'refunded', 'closed']

interface OrderItemLean {
  productId: Types.ObjectId
  itemType?: OrderItemType
  name: string
  price: number
  quantity: number
}

interface OrderLean {
  _id: Types.ObjectId
  userId: Types.ObjectId
  orderNumber: string
  status?: OrderStatus
  orderStatus?: OrderStatus
  paymentStatus?: PaymentStatus
  totalAmount: number
  paymentMethod?: string
  paymentProvider?: string
  prepayId?: string
  transactionId?: string
  paidAt?: Date
  paymentResult?: Record<string, unknown>
  shippingAddress?: string
  items: OrderItemLean[]
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

interface ProductLean {
  _id: Types.ObjectId
  slug: string
  name: string
  price: number
  coverUrl?: string
  description?: string
}

interface VehicleLean {
  _id: Types.ObjectId
  productId: Types.ObjectId
  identifier: string
  name: string
  description?: string
  coverUrl?: string
}

interface AppUserLean {
  _id: Types.ObjectId
  displayName?: string
  username?: string
}

interface OrderResponseItem {
  productId: string
  itemType: OrderItemType
  name: string
  price: number
  quantity: number
  product?: {
    id: string
    slug: string
    coverUrl?: string
    description?: string
  }
  vehicle?: {
    id: string
    identifier: string
    name: string
    description?: string
    coverUrl?: string
  }
}

interface OrderResponse {
  id: string
  orderNumber: string
  customerName: string
  status: OrderStatus
  orderStatus: OrderStatus
  paymentStatus: PaymentStatus
  totalAmount: number
  paymentMethod?: string
  paymentProvider?: string
  transactionId?: string
  paidAt?: string
  paymentResult?: Record<string, unknown>
  shippingAddress?: string
  items: OrderResponseItem[]
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

type CreateOrderBody = {
  items?: Array<{
    productId?: string
    itemType?: OrderItemType
    quantity?: number
  }>
  paymentMethod?: string
  shippingAddress?: string
  metadata?: Record<string, unknown>
}

function resolveOrderStatus(order: OrderLean): OrderStatus {
  return order.orderStatus ?? order.status ?? 'pending'
}

function resolvePaymentStatus(order: OrderLean): PaymentStatus {
  return order.paymentStatus ?? (resolveOrderStatus(order) === 'paid' ? 'succeeded' : 'unpaid')
}

function pickOrderItemType(value: unknown): OrderItemType {
  if (value === 'product' || value === 'prop' || value === 'equipment' || value === 'service' || value === 'other') {
    return value
  }
  return 'product'
}

async function buildProductMap(productIds: string[]): Promise<Map<string, ProductLean>> {
  if (!productIds.length) {
    return new Map()
  }
  const products = (await ProductModel.find({ _id: { $in: productIds } })
    .lean()
    .exec()) as ProductLean[]
  return new Map(products.map((product) => [product._id.toString(), product]))
}

async function buildVehicleMapByProductId(productIds: string[]): Promise<Map<string, VehicleLean>> {
  if (!productIds.length) {
    return new Map()
  }
  const rows = (await VehicleModel.find({ productId: { $in: productIds } }).lean().exec()) as VehicleLean[]
  return new Map(rows.map((row) => [row.productId.toString(), row]))
}

async function buildUserMap(userIds: string[]): Promise<Map<string, AppUserLean>> {
  if (!userIds.length) {
    return new Map()
  }
  const users = (await AppUserModel.find({ _id: { $in: userIds } }).lean().exec()) as AppUserLean[]
  return new Map(users.map((user) => [user._id.toString(), user]))
}

function buildOrderResponse(
  order: OrderLean,
  productMap: Map<string, ProductLean>,
  vehicleMapByProductId: Map<string, VehicleLean>,
  userMap: Map<string, AppUserLean>,
): OrderResponse {
  const user = userMap.get(order.userId.toString())
  const customerName = user?.displayName || user?.username || ''
  const orderStatus = resolveOrderStatus(order)
  const paymentStatus = resolvePaymentStatus(order)
  const items: OrderResponseItem[] = order.items.map((item) => {
    const productId = item.productId.toString()
    const product = productMap.get(productId)
    const vehicle = vehicleMapByProductId.get(productId)
    return {
      productId,
      itemType: pickOrderItemType(item.itemType),
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      product: product
        ? {
            id: product._id.toString(),
            slug: product.slug,
            coverUrl: product.coverUrl ?? undefined,
            description: product.description ?? undefined,
          }
        : undefined,
      vehicle: vehicle
        ? {
            id: vehicle._id.toString(),
            identifier: vehicle.identifier,
            name: vehicle.name,
            description: vehicle.description ?? undefined,
            coverUrl: vehicle.coverUrl ?? undefined,
          }
        : undefined,
    }
  })
  return {
    id: order._id.toString(),
    orderNumber: order.orderNumber,
    customerName,
    status: orderStatus,
    orderStatus,
    paymentStatus,
    totalAmount: order.totalAmount,
    paymentMethod: order.paymentMethod ?? undefined,
    paymentProvider: order.paymentProvider ?? undefined,
    transactionId: order.transactionId ?? undefined,
    paidAt: order.paidAt ? order.paidAt.toISOString() : undefined,
    paymentResult: order.paymentResult,
    shippingAddress: order.shippingAddress ?? undefined,
    items,
    metadata: order.metadata,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  }
}

export async function listOrders(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { status, paymentStatus } = ctx.query as { status?: string; paymentStatus?: string }
  const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) }
  if (status && ORDER_STATUS_VALUES.includes(status as OrderStatus)) {
    filter.orderStatus = status
  }
  if (paymentStatus && PAYMENT_STATUS_VALUES.includes(paymentStatus as PaymentStatus)) {
    filter.paymentStatus = paymentStatus
  }
  const orders = (await OrderModel.find(filter).sort({ createdAt: -1 }).lean().exec()) as OrderLean[]
  const productIds = new Set<string>()
  orders.forEach((order) => {
    order.items.forEach((item) => {
      productIds.add(item.productId.toString())
    })
  })
  const productMap = await buildProductMap(Array.from(productIds))
  const vehicleMapByProductId = await buildVehicleMapByProductId(Array.from(productIds))
  const userIds = Array.from(new Set(orders.map((order) => order.userId.toString())))
  const userMap = await buildUserMap(userIds)
  const data = orders.map((order) => buildOrderResponse(order, productMap, vehicleMapByProductId, userMap))
  ctx.body = {
    total: data.length,
    orders: data,
  }
}

export async function getOrder(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid order id')
  }
  const order = (await OrderModel.findOne({ _id: id, userId }).lean().exec()) as OrderLean | null
  if (!order) {
    ctx.throw(404, 'Order not found')
    return
  }
  const productIds = Array.from(new Set(order.items.map((item) => item.productId.toString())))
  const productMap = await buildProductMap(productIds)
  const vehicleMapByProductId = await buildVehicleMapByProductId(productIds)
  const userMap = await buildUserMap([order.userId.toString()])
  ctx.body = buildOrderResponse(order, productMap, vehicleMapByProductId, userMap)
}

export async function createOrder(ctx: Context): Promise<void> {
  const checkoutUser = await ensureMiniCheckoutUser(ctx)
  const userId = checkoutUser.id
  const body = (ctx.request.body ?? {}) as CreateOrderBody
  const inputItems = Array.isArray(body.items) ? body.items : []
  if (!inputItems.length) {
    ctx.throw(400, 'Order items are required')
  }

  const normalizedItems = inputItems.map((item) => ({
    productId: typeof item.productId === 'string' ? item.productId : '',
    itemType: pickOrderItemType(item.itemType),
    quantity: Math.max(1, Math.floor(Number(item.quantity ?? 1) || 1)),
  }))

  const invalidItem = normalizedItems.find((item) => !Types.ObjectId.isValid(item.productId))
  if (invalidItem) {
    ctx.throw(400, 'Invalid product id in items')
  }

  const productIds = normalizedItems.map((item) => item.productId)
  const products = await ProductModel.find({ _id: { $in: productIds }, isDeleted: { $ne: true } }).lean().exec()
  const productMap = new Map(products.map((item: any) => [item._id.toString(), item]))

  const missingProduct = normalizedItems.find((item) => !productMap.has(item.productId))
  if (missingProduct) {
    ctx.throw(404, 'Product not found')
  }

  const orderItems = normalizedItems.map((item) => {
    const product = productMap.get(item.productId) as any
    return {
      productId: new Types.ObjectId(item.productId),
      itemType: item.itemType,
      name: product.name,
      price: Number(product.price ?? 0),
      quantity: item.quantity,
    }
  })

  const totalAmount = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const now = new Date()
  const created = await OrderModel.create({
    userId: new Types.ObjectId(userId),
    orderNumber: generateOrderNumber(),
    status: 'pending',
    orderStatus: 'pending',
    paymentStatus: 'unpaid',
    totalAmount,
    paymentMethod: body.paymentMethod || 'wechat',
    shippingAddress: body.shippingAddress,
    items: orderItems,
    metadata: {
      source: 'mini-order-create',
      ...(body.metadata ?? {}),
    },
    createdAt: now,
    updatedAt: now,
  })

  const row = (await OrderModel.findById(created._id).lean().exec()) as OrderLean | null
  if (!row) {
    ctx.throw(500, 'Failed to create order')
    return
  }
  const productIdList = Array.from(new Set(row.items.map((item) => item.productId.toString())))
  const relationProductMap = await buildProductMap(productIdList)
  const vehicleMap = await buildVehicleMapByProductId(productIdList)
  const userMap = await buildUserMap([row.userId.toString()])
  ctx.status = 201
  ctx.body = buildOrderResponse(row, relationProductMap, vehicleMap, userMap)
}

export async function payOrder(ctx: Context): Promise<void> {
  const checkoutUser = await ensureMiniCheckoutUser(ctx)
  const userId = checkoutUser.id
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid order id')
  }

  const order = await OrderModel.findOne({ _id: id, userId }).exec()
  if (!order) {
    ctx.throw(404, 'Order not found')
    return
  }

  const orderStatus = (order.orderStatus ?? order.status) as OrderStatus
  const paymentStatus = (order.paymentStatus ?? (orderStatus === 'paid' ? 'succeeded' : 'unpaid')) as PaymentStatus
  if (orderStatus === 'completed' || orderStatus === 'cancelled') {
    ctx.throw(400, 'Order is not payable')
  }
  if (paymentStatus === 'succeeded') {
    ctx.throw(400, 'Order already paid')
  }

  const description = (order.items[0]?.name || 'Harmony商品支付').slice(0, 120)
  const paymentResult = await createOrderPayment({
    channel: 'wechat',
    miniAppId: checkoutUser.miniAppId,
    orderNumber: order.orderNumber,
    description,
    amount: order.totalAmount,
    openId: checkoutUser.wxOpenId,
    attach: JSON.stringify({ orderId: order._id.toString(), userId }),
  })

  order.paymentMethod = order.paymentMethod || 'wechat'
  order.paymentProvider = paymentResult.provider
  order.paymentStatus = paymentResult.status === 'pending' ? 'processing' : 'failed'
  order.prepayId = paymentResult.prepayId
  order.paymentResult = {
    ...(order.paymentResult ?? {}),
    prepay: paymentResult.raw ?? null,
    requestedAt: new Date().toISOString(),
  }
  await order.save()

  ctx.body = {
    orderId: order._id.toString(),
    orderNumber: order.orderNumber,
    status: order.orderStatus ?? order.status,
    paymentStatus: order.paymentStatus,
    payParams: paymentResult.payParams,
  }
}
