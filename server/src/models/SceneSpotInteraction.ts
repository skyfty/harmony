import { Schema, model } from 'mongoose'
import type { SceneSpotInteractionDocument } from '@/types/models'

const sceneSpotInteractionSchema = new Schema<SceneSpotInteractionDocument>(
  {
    sceneSpotId: { type: Schema.Types.ObjectId, ref: 'SceneSpot', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    favorited: { type: Boolean, default: false },
    rating: { type: Number, min: 1, max: 5, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

sceneSpotInteractionSchema.index({ sceneSpotId: 1, userId: 1 }, { unique: true })

export const SceneSpotInteractionModel = model<SceneSpotInteractionDocument>(
  'SceneSpotInteraction',
  sceneSpotInteractionSchema,
)
