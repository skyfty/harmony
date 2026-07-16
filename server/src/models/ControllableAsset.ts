import { Schema, model } from 'mongoose'
import type { ControllableAssetDocument } from '@/types/models'

const controllableAssetSchema = new Schema<ControllableAssetDocument>(
  {
    identifier: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['vehicle', 'character', 'ship', 'aircraft'], required: true },
    sortOrder: { type: Number, default: 0 },
    description: { type: String, default: '' },
    prefabUrl: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, unique: true },
    runtimeConfig: { type: Schema.Types.Mixed, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, versionKey: false },
)

controllableAssetSchema.index({ type: 1, identifier: 1 }, { unique: true })
controllableAssetSchema.index({ type: 1, sortOrder: 1, createdAt: -1 })
controllableAssetSchema.index({ name: 'text', description: 'text' })

export const ControllableAssetModel = model<ControllableAssetDocument>('ControllableAsset', controllableAssetSchema)
