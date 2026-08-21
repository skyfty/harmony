import { Schema, model } from 'mongoose'
import type { SkinCategoryDocument } from '@/types/models'

const skinCategorySchema = new Schema<SkinCategoryDocument>(
  {
    name: { type: String, required: true, trim: true },
    slotKey: {
      type: String,
      enum: ['hatAssetId', 'glassesAssetId', 'hairAssetId', 'topAssetId', 'pantsAssetId', 'shoesAssetId'],
      required: true,
    },
    sortOrder: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true },
    description: { type: String, default: null },
    isBuiltin: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
)

skinCategorySchema.index({ name: 1 }, { unique: true })
skinCategorySchema.index({ slotKey: 1 }, { unique: true })
skinCategorySchema.index({ sortOrder: 1, createdAt: -1 })

export const SkinCategoryModel = model<SkinCategoryDocument>('SkinCategory', skinCategorySchema)
