import { Schema, model } from 'mongoose'
import type { AssetDocument } from '@/types/models'

const assetSchema = new Schema<AssetDocument>(
  {
    name: { type: String, required: true, trim: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'AssetCategory', required: true },
    type: { type: String, enum: ['model', 'image', 'texture', 'file'], required: true },
    size: { type: Number, default: 0 },
    url: { type: String, required: true },
    previewUrl: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

assetSchema.index({ categoryId: 1, createdAt: -1 })

export const AssetModel = model<AssetDocument>('Asset', assetSchema)
