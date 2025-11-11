import { Schema, model } from 'mongoose'
import type { AssetCategoryDocument } from '@/types/models'

const assetCategorySchema = new Schema<AssetCategoryDocument>(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['model', 'image', 'texture', 'material', 'file', 'prefab', 'video', 'mesh'], required: true },
    description: { type: String },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

assetCategorySchema.index({ name: 1 }, { unique: true })

export const AssetCategoryModel = model<AssetCategoryDocument>('AssetCategory', assetCategorySchema)
