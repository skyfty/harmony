import { Schema, model } from 'mongoose'
import type { ProductCategoryDocument } from '@/types/models'

const productCategorySchema = new Schema<ProductCategoryDocument>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    sortOrder: { type: Number, required: true, default: 0 },
    enabled: { type: Boolean, required: true, default: true },
    normalizedName: { type: String, required: true, trim: true },
    isBuiltin: { type: Boolean, required: true, default: false },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

productCategorySchema.index({ normalizedName: 1 }, { unique: true })
productCategorySchema.index({ sortOrder: 1, createdAt: -1 })

export const ProductCategoryModel = model<ProductCategoryDocument>('ProductCategory', productCategorySchema)
