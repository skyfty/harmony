import { Schema, model } from 'mongoose'
import type { AchievementDocument } from '@/types/models'

const achievementSchema = new Schema<AchievementDocument>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null, trim: true },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

achievementSchema.index({ name: 1 })

export const AchievementModel = model<AchievementDocument>('Achievement', achievementSchema)
