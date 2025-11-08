import { Schema, model } from 'mongoose'
import type { WorkCollectionDocument } from '@/types/models'

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

const workCollectionSchema = new Schema<WorkCollectionDocument>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    coverUrl: { type: String },
    workIds: { type: [Schema.Types.ObjectId], ref: 'Work', default: [] },
    isPublic: { type: Boolean, default: false },
    likes: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    ratings: { type: [ratingSchema], default: [] },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

workCollectionSchema.index({ ownerId: 1, createdAt: -1 })

export const WorkCollectionModel = model<WorkCollectionDocument>('WorkCollection', workCollectionSchema)
