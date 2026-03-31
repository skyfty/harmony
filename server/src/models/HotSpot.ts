import { Schema, model } from 'mongoose'
import type { HotSpotDocument } from '@/types/models'

const hotSpotSchema = new Schema<HotSpotDocument>(
  {
    sceneSpotId: { type: Schema.Types.ObjectId, ref: 'SceneSpot', required: true },
    order: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

hotSpotSchema.index({ order: 1 })
hotSpotSchema.index({ sceneSpotId: 1 })

export const HotSpotModel = model<HotSpotDocument>('HotSpot', hotSpotSchema)
