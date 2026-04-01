import { Schema, model } from 'mongoose'
import type { RuleDocument } from '@/types/models'

const ruleSchema = new Schema<RuleDocument>(
  {
    name: { type: String, required: true, trim: true },
    scenicId: { type: Schema.Types.ObjectId, ref: 'Scene', default: null },
    enterScenic: { type: Boolean, default: false },
    viewPercentage: { type: Number, default: 0, min: 0, max: 100 },
    enabled: { type: Boolean, default: true },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

ruleSchema.index({ name: 1 })

export const RuleModel = model<RuleDocument>('Rule', ruleSchema)
