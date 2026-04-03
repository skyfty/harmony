import { Schema, model } from 'mongoose'
import type { MedalDocument, MedalRuleType } from '@/types/models'

const MEDAL_RULE_TYPES: MedalRuleType[] = [
  'enter_scenic',
  'punch_ratio_gte',
  'enter_count_gte',
  'punch_count_gte',
  'specific_scenic_set_complete',
]

const medalRuleSchema = new Schema(
  {
    type: { type: String, enum: MEDAL_RULE_TYPES, required: true },
    params: { type: Schema.Types.Mixed, default: {} },
    order: { type: Number, default: 0 },
  },
  {
    _id: false,
  },
)

const medalSchema = new Schema<MedalDocument>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null, trim: true },
    lockedIconUrl: { type: String, default: null, trim: true },
    unlockedIconUrl: { type: String, default: null, trim: true },
    enabled: { type: Boolean, default: true, index: true },
    sort: { type: Number, default: 0, index: true },
    rules: { type: [medalRuleSchema], default: [] },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

medalSchema.index({ name: 1 })
medalSchema.index({ enabled: 1, sort: 1, createdAt: -1 })

export const MedalModel = model<MedalDocument>('Medal', medalSchema)