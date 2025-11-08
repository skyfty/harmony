import { Schema, model } from 'mongoose'
import type { OptimizeProductDocument } from '@/types/models'

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

const purchaseEntrySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    purchasedAt: { type: Date, default: Date.now },
  },
  { _id: false },
)

const optimizeProductSchema = new Schema<OptimizeProductDocument>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    category: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    imageUrl: { type: String },
    description: { type: String, default: '' },
    tags: { type: [String], default: [] },
    usageConfig: { type: usageConfigSchema, default: undefined },
    purchasedBy: { type: [purchaseEntrySchema], default: [] },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

optimizeProductSchema.index({ category: 1 })
optimizeProductSchema.index({ name: 'text', description: 'text', tags: 'text' })

export const OptimizeProductModel = model<OptimizeProductDocument>('OptimizeProduct', optimizeProductSchema)
