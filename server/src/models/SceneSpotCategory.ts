import { Schema, model } from 'mongoose'
import type { SceneSpotCategoryDocument } from '@/types/models'

const sceneSpotCategorySchema = new Schema<SceneSpotCategoryDocument>(
  {
    name: { type: String, required: true, trim: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'SceneSpotCategory', default: null },
    description: { type: String, default: null },
    slug: { type: String, default: null, index: true },
    sortOrder: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true },
    isBuiltin: { type: Boolean, default: false },
    normalizedName: { type: String, default: null, index: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

sceneSpotCategorySchema.index({ normalizedName: 1 })
sceneSpotCategorySchema.index({ parentId: 1, sortOrder: 1 })
sceneSpotCategorySchema.index({ sortOrder: 1 })

export const SceneSpotCategoryModel = model<SceneSpotCategoryDocument>('SceneSpotCategory', sceneSpotCategorySchema)
