import { Schema, model } from 'mongoose'
import type { VehicleDocument } from '@/types/models'

const vehicleSchema = new Schema<VehicleDocument>(
  {
    identifier: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    coverUrl: { type: String, required: true, default: '' },
    prefabUrl: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    // Performance / tuning attributes
    maxSpeed: { type: Number, default: 120, min: 0 },
    acceleration: { type: Number, default: 6, min: 0 },
    braking: { type: Number, default: 6, min: 0 },
    handling: { type: Number, default: 0.5, min: 0 },
    mass: { type: Number, default: 1500, min: 0 },
    drag: { type: Number, default: 0.3, min: 0 },
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
