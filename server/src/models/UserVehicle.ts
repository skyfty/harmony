import { Schema, model } from 'mongoose'
import type { UserVehicleDocument } from '@/types/models'

const userVehicleSchema = new Schema<UserVehicleDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    ownedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

userVehicleSchema.index({ userId: 1, vehicleId: 1 }, { unique: true })
userVehicleSchema.index({ userId: 1, ownedAt: -1 })

export const UserVehicleModel = model<UserVehicleDocument>('UserVehicle', userVehicleSchema)
