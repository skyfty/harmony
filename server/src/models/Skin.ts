import { Schema, model } from 'mongoose'
import type { SkinDocument } from '@/types/models'

const skinSchema = new Schema<SkinDocument>(
  {
    identifier: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'SkinCategory', required: true },
    prefabUrl: { type: String, default: '' },
    sortOrder: { type: Number, default: 0 },
    description: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, unique: true },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, versionKey: false },
)

skinSchema.index({ categoryId: 1, identifier: 1 }, { unique: true })
skinSchema.index({ categoryId: 1, sortOrder: 1, createdAt: -1 })
skinSchema.index({ name: 'text', description: 'text' })

export const SkinModel = model<SkinDocument>('Skin', skinSchema)
