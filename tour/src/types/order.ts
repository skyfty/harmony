export type OrderStatus = 'pending' | 'paid' | 'completed' | 'cancelled';

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  product?: {
    id: string;
    slug: string;
    category: string;
    imageUrl?: string;
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
  status: OrderStatus;
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
