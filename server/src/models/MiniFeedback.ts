import { Schema, model } from 'mongoose'
import type { MiniFeedbackDocument } from '@/types/models'

const miniFeedbackSchema = new Schema<MiniFeedbackDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    category: { type: String, enum: ['bug', 'ui', 'feature', 'content', 'other'], default: 'other' },
    content: { type: String, required: true, trim: true },
    contact: { type: String, default: null, trim: true },
    status: { type: String, enum: ['new', 'in_progress', 'resolved', 'closed'], default: 'new' },
    reply: { type: String, default: null, trim: true },
    repliedAt: { type: Date, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

miniFeedbackSchema.index({ userId: 1, createdAt: -1 })
miniFeedbackSchema.index({ status: 1, updatedAt: -1 })

export const MiniFeedbackModel = model<MiniFeedbackDocument>('MiniFeedback', miniFeedbackSchema)
