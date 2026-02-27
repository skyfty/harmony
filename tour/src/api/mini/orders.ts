import type { OrderDetail, OrderListItem, OrderStatus } from '@/types/order'
import { miniRequest } from '@harmony/utils'
import { ensureMiniAuth } from './session'

type ListOrdersResponse = {
  total: number
  orders: OrderListItem[]
}

export async function listOrders(status?: OrderStatus): Promise<OrderListItem[]> {
  await ensureMiniAuth()
  const response = await miniRequest<ListOrdersResponse>('/orders', {
    method: 'GET',
    query: {
      status,
    },
  })
  return Array.isArray(response.orders) ? response.orders : []
}

export async function getOrderDetail(id: string): Promise<OrderDetail | null> {
  if (!id) {
    return null
  }
  await ensureMiniAuth()
  return await miniRequest<OrderDetail>(`/orders/${encodeURIComponent(id)}`, {
    method: 'GET',
  })
}

export interface CreateOrderPayload {
  paymentMethod?: 'wechat'
  shippingAddress?: string
  metadata?: Record<string, unknown>
  items: Array<{
    productId: string
    itemType?: 'product' | 'prop' | 'equipment' | 'service' | 'other'
    quantity?: number
  }>
}

export interface PayOrderResult {
  orderId: string
  orderNumber: string
  status: OrderStatus
  paymentStatus: 'unpaid' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'closed'
  payParams?: {
    appId: string
    timeStamp: string
    nonceStr: string
    package: string
    signType: 'RSA'
    paySign: string
    prepayId: string
  }
}

export async function createOrder(payload: CreateOrderPayload): Promise<OrderDetail> {
  await ensureMiniAuth()
  return await miniRequest<OrderDetail>('/orders', {
    method: 'POST',
    body: payload,
  })
}

export async function payOrder(orderId: string): Promise<PayOrderResult> {
  await ensureMiniAuth()
  return await miniRequest<PayOrderResult>(`/orders/${encodeURIComponent(orderId)}/pay`, {
    method: 'POST',
    body: {},
  })
}
