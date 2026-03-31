import { Schema, model } from 'mongoose'
import type { FeaturedSpotDocument } from '@/types/models'

const featuredSpotSchema = new Schema<FeaturedSpotDocument>(
  {
    sceneSpotId: { type: Schema.Types.ObjectId, ref: 'SceneSpot', required: true },
    order: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

featuredSpotSchema.index({ order: 1 })
featuredSpotSchema.index({ sceneSpotId: 1 })

export const FeaturedSpotModel = model<FeaturedSpotDocument>('FeaturedSpot', featuredSpotSchema)
