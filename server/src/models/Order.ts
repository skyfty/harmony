import { Schema, model } from 'mongoose'
import type { OrderDocument } from '@/types/models'

const orderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    itemType: {
      type: String,
      enum: ['product', 'prop', 'equipment', 'service', 'other'],
      default: 'product',
      required: true,
    },
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
  },
  { _id: false },
)

const orderSchema = new Schema<OrderDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'AppUser', required: true, index: true },
    orderNumber: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ['pending', 'paid', 'completed', 'cancelled'], default: 'pending' },
    orderStatus: { type: String, enum: ['pending', 'paid', 'completed', 'cancelled'], default: 'pending' },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'processing', 'succeeded', 'failed', 'refunded', 'closed'],
      default: 'unpaid',
      index: true,
    },
    refundStatus: {
      type: String,
      enum: ['none', 'applied', 'approved', 'rejected', 'processing', 'succeeded', 'failed'],
      default: 'none',
      index: true,
    },
    refundReason: { type: String },
    refundRequestedAt: { type: Date },
    refundReviewedAt: { type: Date },
    refundReviewedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
    refundRejectReason: { type: String },
    refundAmount: { type: Number, min: 0 },
    refundRequestNo: { type: String, index: true },
    refundId: { type: String },
    refundedAt: { type: Date },
    refundResult: { type: Schema.Types.Mixed },
    fulfillmentStatus: {
      type: String,
      enum: ['pending', 'fulfilled'],
      default: 'pending',
      index: true,
    },
    fulfilledAt: { type: Date },
    totalAmount: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String },
    paymentProvider: { type: String },
    prepayId: { type: String },
    transactionId: { type: String },
    paidAt: { type: Date },
    paymentResult: { type: Schema.Types.Mixed },
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
orderSchema.index({ userId: 1, paymentStatus: 1, createdAt: -1 })
orderSchema.index({ userId: 1, refundStatus: 1, createdAt: -1 })

export const OrderModel = model<OrderDocument>('Order', orderSchema)
