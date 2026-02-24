import { Schema, model } from 'mongoose'
import type { VehicleDocument } from '@/types/models'

const vehicleSchema = new Schema<VehicleDocument>(
  {
    identifier: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    coverUrl: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

vehicleSchema.index(
  { identifier: 1 },
  {
    unique: true,
    partialFilterExpression: {
      identifier: { $type: 'string', $ne: '' },
    },
  },
)
vehicleSchema.index({ name: 1 })
vehicleSchema.index({ name: 'text', description: 'text' })
vehicleSchema.index(
  { productId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      productId: { $type: 'objectId' },
    },
  },
)

export const VehicleModel = model<VehicleDocument>('Vehicle', vehicleSchema)
