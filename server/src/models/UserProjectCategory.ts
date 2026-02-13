import { Schema, model } from 'mongoose'
import type { UserProjectCategoryDocument } from '@/types/models'

const userProjectCategorySchema = new Schema<UserProjectCategoryDocument>(
  {
    name: { type: String, required: true },
    description: { type: String, required: false, default: null },
    sortOrder: { type: Number, required: true, default: 0 },
    enabled: { type: Boolean, required: true, default: true },
    normalizedName: { type: String, required: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

// Global categories: unique normalizedName across collection
userProjectCategorySchema.index({ normalizedName: 1 }, { unique: true })
userProjectCategorySchema.index({ sortOrder: 1, createdAt: -1 })

export const UserProjectCategoryModel = model<UserProjectCategoryDocument>('UserProjectCategory', userProjectCategorySchema)
