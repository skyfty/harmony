import { Schema, model } from 'mongoose'
import type { OptimizeWarehouseDocument } from '@/types/models'

const usageSnapshotSchema = new Schema(
  {
    name: { type: String, required: true },
    category: { type: String, required: true },
    price: { type: Number, required: true },
    imageUrl: { type: String },
    description: { type: String },
    usageConfig: { type: Schema.Types.Mixed },
  },
  { _id: false },
)

const warehouseSchema = new Schema<OptimizeWarehouseDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, default: 0, min: 0 },
    totalPurchased: { type: Number, default: 0, min: 0 },
    totalConsumed: { type: Number, default: 0, min: 0 },
    productSnapshot: { type: usageSnapshotSchema, required: true },
    latestOrderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    lastPurchasedAt: { type: Date, default: null },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

warehouseSchema.index({ userId: 1, productId: 1 }, { unique: true })
warehouseSchema.index({ updatedAt: -1 })

export const OptimizeWarehouseModel = model<OptimizeWarehouseDocument>('OptimizeWarehouse', warehouseSchema)
