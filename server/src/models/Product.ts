import { Schema, model } from 'mongoose'
import type { ProductDocument } from '@/types/models'

const usageConfigSchema = new Schema(
  {
    type: { type: String, enum: ['permanent', 'consumable'], default: 'permanent' },
    perExhibitionLimit: { type: Number, default: null },
    exclusiveGroup: { type: String, default: null },
    stackable: { type: Boolean, default: false },
    notes: { type: String, default: '' },
  },
  { _id: false },
)

const productSchema = new Schema<ProductDocument>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    category: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    imageUrl: { type: String },
    coverUrl: { type: String },
    summary: { type: String, default: '' },
    description: { type: String, default: '' },
    tags: { type: [String], default: [] },
    usageConfig: { type: usageConfigSchema, default: undefined },
    validityDays: { type: Number, default: null, min: 1 },
    applicableSceneTags: { type: [String], default: [] },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

productSchema.index({ category: 1 })
productSchema.index({ name: 'text', summary: 'text', description: 'text', tags: 'text' })

export const ProductModel = model<ProductDocument>('Product', productSchema)
