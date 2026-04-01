import { Schema, model } from 'mongoose'
import type { AchievementRuleDocument } from '@/types/models'

const achievementRuleSchema = new Schema<AchievementRuleDocument>(
  {
    achievementId: { type: Schema.Types.ObjectId, ref: 'Achievement', required: true, index: true },
    ruleId: { type: Schema.Types.ObjectId, ref: 'Rule', required: true, index: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

// Prevent duplicate links
achievementRuleSchema.index({ achievementId: 1, ruleId: 1 }, { unique: true })

export const AchievementRuleModel = model<AchievementRuleDocument>('AchievementRule', achievementRuleSchema)
