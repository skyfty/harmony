import { Schema, model } from 'mongoose'
import type { SceneSpotDocument } from '@/types/models'

const sceneSpotSchema = new Schema<SceneSpotDocument>(
  {
    sceneId: { type: Schema.Types.ObjectId, ref: 'Scene', required: true },
    title: { type: String, required: true, trim: true },
    summary: { type: String, default: '' },
    coverUrl: { type: String, default: null },
    order: { type: Number, default: 0 },
    anchor: { type: Schema.Types.Mixed, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

sceneSpotSchema.index({ sceneId: 1, order: 1 })
sceneSpotSchema.index({ title: 'text', summary: 'text' })

export const SceneSpotModel = model<SceneSpotDocument>('SceneSpot', sceneSpotSchema)
