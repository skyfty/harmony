import { Schema, model } from 'mongoose'
import type { MiniAchievementDocument } from '@/types/models'

const miniAchievementSchema = new Schema<MiniAchievementDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    progress: { type: Number, required: true, min: 0, max: 1, default: 0 },
    scenicId: { type: Schema.Types.ObjectId, ref: 'SceneSpot', default: null },
    achievedAt: { type: Date, default: Date.now },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

miniAchievementSchema.index({ userId: 1, achievedAt: -1 })
miniAchievementSchema.index({ userId: 1, scenicId: 1 })

export const MiniAchievementModel = model<MiniAchievementDocument>('MiniAchievement', miniAchievementSchema)
