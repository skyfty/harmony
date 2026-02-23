import { Schema, model } from 'mongoose'
import type { VehicleDocument } from '@/types/models'

const vehicleSchema = new Schema<VehicleDocument>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

vehicleSchema.index({ name: 1 })
vehicleSchema.index({ name: 'text', description: 'text' })

export const VehicleModel = model<VehicleDocument>('Vehicle', vehicleSchema)
