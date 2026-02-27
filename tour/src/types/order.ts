export type OrderStatus = 'pending' | 'paid' | 'completed' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'closed';

export interface OrderItem {
  productId: string;
  itemType?: 'product' | 'prop' | 'equipment' | 'service' | 'other';
  name: string;
  price: number;
  quantity: number;
  product?: {
    id: string;
    slug: string;
    coverUrl?: string;
    description?: string;
  };
  vehicle?: {
    id: string;
    identifier: string;
    name: string;
    description?: string;
    coverUrl?: string;
  };
}

export interface OrderListItem {
  id: string;
  orderNumber: string;
  customerName: string;
  status: OrderStatus;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentProvider?: string;
  transactionId?: string;
  paidAt?: string;
  paymentResult?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  totalAmount: number;
  items: OrderItem[];
  paymentMethod?: string;
  shippingAddress?: string;
  metadata?: Record<string, unknown>;
}

export interface OrderDetail extends OrderListItem {
}
