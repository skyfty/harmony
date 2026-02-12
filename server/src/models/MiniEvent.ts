import { Schema, model } from 'mongoose'
import type { MiniEventDocument } from '@/types/models'

const miniEventSchema = new Schema<MiniEventDocument>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    coverUrl: { type: String, default: null },
    locationText: { type: String, default: null },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    sceneId: { type: Schema.Types.ObjectId, ref: 'Scene', default: null },
    hotScore: { type: Number, default: 0 },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

miniEventSchema.index({ hotScore: -1, createdAt: -1 })
miniEventSchema.index({ sceneId: 1, startAt: 1 })

export const MiniEventModel = model<MiniEventDocument>('MiniEvent', miniEventSchema)
