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
