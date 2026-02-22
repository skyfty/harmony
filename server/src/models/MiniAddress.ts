import { Schema, model } from 'mongoose'
import type { MiniAddressDocument } from '@/types/models'

const miniAddressSchema = new Schema<MiniAddressDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    receiverName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    region: { type: String, required: true, trim: true },
    detail: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, default: false },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

miniAddressSchema.index({ userId: 1, updatedAt: -1 })
miniAddressSchema.index({ userId: 1, isDefault: 1 })

export const MiniAddressModel = model<MiniAddressDocument>('MiniAddress', miniAddressSchema)
