import { Schema, model } from 'mongoose'
import type { OrderDocument } from '@/types/models'

const orderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
  },
  { _id: false },
)

const orderSchema = new Schema<OrderDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderNumber: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ['pending', 'paid', 'completed', 'cancelled'], default: 'pending' },
    totalAmount: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String },
    shippingAddress: { type: String },
    items: { type: [orderItemSchema], required: true },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

orderSchema.index({ createdAt: -1 })

export const OrderModel = model<OrderDocument>('Order', orderSchema)
