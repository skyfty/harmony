import type { Context } from 'koa'
import { Types } from 'mongoose'
import { OrderModel } from '@/models/Order'
import { ProductModel } from '@/models/Product'
import { VehicleModel } from '@/models/Vehicle'
import { ensureUserId } from './utils'

interface OrderItemLean {
  productId: Types.ObjectId
  name: string
  price: number
  quantity: number
}

interface OrderLean {
  _id: Types.ObjectId
  userId: Types.ObjectId
  orderNumber: string
  status: 'pending' | 'paid' | 'completed' | 'cancelled'
  totalAmount: number
  paymentMethod?: string
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

interface OrderResponseItem {
  productId: string
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
  status: 'pending' | 'paid' | 'completed' | 'cancelled'
  totalAmount: number
  paymentMethod?: string
  shippingAddress?: string
  items: OrderResponseItem[]
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
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

function buildOrderResponse(
  order: OrderLean,
  productMap: Map<string, ProductLean>,
  vehicleMapByProductId: Map<string, VehicleLean>,
): OrderResponse {
  const items: OrderResponseItem[] = order.items.map((item) => {
    const productId = item.productId.toString()
    const product = productMap.get(productId)
    const vehicle = vehicleMapByProductId.get(productId)
    return {
      productId,
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
    status: order.status,
    totalAmount: order.totalAmount,
    paymentMethod: order.paymentMethod ?? undefined,
    shippingAddress: order.shippingAddress ?? undefined,
    items,
    metadata: order.metadata,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  }
}

export async function listOrders(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { status } = ctx.query as { status?: string }
  const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) }
  if (status && ['pending', 'paid', 'completed', 'cancelled'].includes(status)) {
    filter.status = status
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
  const data = orders.map((order) => buildOrderResponse(order, productMap, vehicleMapByProductId))
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
  ctx.body = buildOrderResponse(order, productMap, vehicleMapByProductId)
}
