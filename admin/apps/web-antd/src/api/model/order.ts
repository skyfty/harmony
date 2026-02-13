export interface OrderItemModel {
  id: string;
  orderNumber: string;
  status: 'pending' | 'paid' | 'completed' | 'cancelled';
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderCreateModel {
  userId: string;
  items: Array<{ productId: string; name?: string; price?: number; quantity?: number }>;
  orderNumber?: string;
}
