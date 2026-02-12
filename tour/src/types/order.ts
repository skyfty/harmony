export type OrderStatus = 'pending' | 'paid' | 'completed' | 'cancelled';

export interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface OrderListItem {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  createdAt: string;
  totalAmount: number;
  itemCount: number;
}

export interface OrderDetail extends OrderListItem {
  items: OrderItem[];
}
