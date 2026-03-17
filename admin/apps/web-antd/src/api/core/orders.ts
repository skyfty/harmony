import { requestClient } from '#/api/request';

interface ServerPageResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

interface GridPageResult<T> {
  items: T[];
  total: number;
}

export interface OrderItem {
  id: string;
  orderNumber: string;
  status: 'pending' | 'paid' | 'completed' | 'cancelled';
  orderStatus?: 'pending' | 'paid' | 'completed' | 'cancelled';
  paymentStatus?: 'unpaid' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'closed';
  refundStatus?: 'none' | 'applied' | 'approved' | 'rejected' | 'processing' | 'succeeded' | 'failed';
  refundReason?: string | null;
  refundRequestedAt?: string | null;
  refundReviewedAt?: string | null;
  refundRejectReason?: string | null;
  refundAmount?: number | null;
  refundRequestNo?: string | null;
  refundId?: string | null;
  refundedAt?: string | null;
  refundResult?: Record<string, unknown> | null;
  totalAmount: number;
  paymentMethod?: string | null;
  paymentProvider?: string | null;
  transactionId?: string | null;
  paidAt?: string | null;
  paymentResult?: Record<string, unknown> | null;
  shippingAddress?: string | null;
  userInfo?: { id: string; username?: string; displayName?: string } | null;
  items: Array<{ productId: string; itemType?: string; name?: string; price?: number; quantity?: number; productInfo?: any | null }>;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListOrdersParams {
  keyword?: string;
  status?: string;
  paymentStatus?: string;
  refundStatus?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateOrderPayload {
  userId: string;
  orderNumber?: string;
  status?: 'pending' | 'paid' | 'completed' | 'cancelled';
  paymentMethod?: string;
  shippingAddress?: string;
  scenicId?: string | null;
  couponId?: string | null;
  metadata?: Record<string, unknown> | null;
  items: Array<{ productId: string; name?: string; price?: number; quantity?: number }>;
}

export interface UpdateOrderPayload {
  status?: 'pending' | 'paid' | 'completed' | 'cancelled';
  paymentMethod?: string | null;
  shippingAddress?: string | null;
  metadata?: Record<string, unknown> | null;
}

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return {
    items: result.data || [],
    total: result.total || 0,
  };
}

export async function listOrdersApi(params: ListOrdersParams) {
  const res = await requestClient.get<ServerPageResult<OrderItem>>('/admin/orders', { params });
  return normalizeGridPage(res);
}

export async function getOrderApi(id: string) {
  return requestClient.get<OrderItem>(`/admin/orders/${id}`);
}

export async function createOrderApi(payload: CreateOrderPayload) {
  return requestClient.post<OrderItem>('/admin/orders', payload);
}

export async function updateOrderApi(id: string, payload: UpdateOrderPayload) {
  return requestClient.put<OrderItem>(`/admin/orders/${id}`, payload);
}

export async function deleteOrderApi(id: string) {
  return requestClient.delete(`/admin/orders/${id}`);
}

export async function approveOrderRefundApi(id: string) {
  return requestClient.post<OrderItem>(`/admin/orders/${id}/refund/approve`, {});
}

export async function rejectOrderRefundApi(id: string, reason: string) {
  return requestClient.post<OrderItem>(`/admin/orders/${id}/refund/reject`, { reason });
}
