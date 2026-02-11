import type { OrderDetail, OrderListItem } from '@/types/order';
import { readStorageJson, writeStorageJson } from '@/utils/storage';

const KEY = 'tour:orders:v1';

const seed: OrderDetail[] = [
  {
    id: 'order-1',
    orderNumber: 'T20260211-0001',
    status: 'paid',
    createdAt: new Date(Date.now() - 86400 * 1000 * 3).toISOString(),
    totalAmount: 198,
    itemCount: 2,
    items: [
      { id: 'item-1', name: '云海山谷门票', price: 99, quantity: 1 },
      { id: 'item-2', name: '观光车体验', price: 99, quantity: 1 },
    ],
  },
  {
    id: 'order-2',
    orderNumber: 'T20260211-0002',
    status: 'pending',
    createdAt: new Date(Date.now() - 86400 * 1000 * 1).toISOString(),
    totalAmount: 59,
    itemCount: 1,
    items: [{ id: 'item-3', name: '湖畔栈道夜游票', price: 59, quantity: 1 }],
  },
];

export function listOrderDetails(): OrderDetail[] {
  const data = readStorageJson<OrderDetail[]>(KEY, []);
  if (Array.isArray(data) && data.length) {
    return data;
  }
  writeStorageJson(KEY, seed);
  return seed;
}

export function listOrders(): OrderListItem[] {
  return listOrderDetails().map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    createdAt: o.createdAt,
    totalAmount: o.totalAmount,
    itemCount: o.itemCount,
  }));
}

export function getOrderDetail(id: string): OrderDetail | undefined {
  return listOrderDetails().find((o) => o.id === id);
}
