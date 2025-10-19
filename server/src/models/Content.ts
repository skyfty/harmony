import { Schema, model } from 'mongoose'
import type { ContentDocument } from '@/types/models'

const contentSchema = new Schema<ContentDocument>(
  {
    slug: { type: String, required: true, unique: true, trim: true },
    title: { type: String, required: true, trim: true },
    summary: { type: String },
    body: { type: String },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

contentSchema.index({ slug: 1 }, { unique: true })

export const ContentModel = model<ContentDocument>('Content', contentSchema)
