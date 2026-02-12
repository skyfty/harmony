import { Schema, model } from 'mongoose'
import type { SceneProductBindingDocument } from '@/types/models'

const sceneProductBindingSchema = new Schema<SceneProductBindingDocument>(
  {
    sceneId: { type: Schema.Types.ObjectId, ref: 'Scene', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    enabled: { type: Boolean, default: true },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

sceneProductBindingSchema.index({ sceneId: 1, productId: 1 }, { unique: true })
sceneProductBindingSchema.index({ productId: 1, enabled: 1 })

export const SceneProductBindingModel = model<SceneProductBindingDocument>('SceneProductBinding', sceneProductBindingSchema)
