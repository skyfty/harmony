import { Schema, model } from 'mongoose'
import type { WorkDocument } from '@/types/models'

const ratingSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    score: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
)

const workSchema = new Schema<WorkDocument>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    mediaType: { type: String, enum: ['image', 'video', 'model', 'other'], default: 'image' },
    fileUrl: { type: String, required: true },
    thumbnailUrl: { type: String },
    size: { type: Number },
    tags: { type: [String], default: [] },
    likedBy: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    ratings: { type: [ratingSchema], default: [] },
    collections: { type: [Schema.Types.ObjectId], ref: 'WorkCollection', default: [] },
    commentCount: { type: Number, default: 0 },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

workSchema.index({ title: 'text', description: 'text' })
workSchema.index({ createdAt: -1 })

export const WorkModel = model<WorkDocument>('Work', workSchema)
