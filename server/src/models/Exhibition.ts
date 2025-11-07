import { Schema, model } from 'mongoose'
import type { ExhibitionDocument } from '@/types/models'

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

const visitSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    visitedAt: { type: Date, default: Date.now },
  },
  { _id: false },
)

const exhibitionSchema = new Schema<ExhibitionDocument>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    coverUrl: { type: String },
    startDate: { type: Date },
    endDate: { type: Date },
    workIds: { type: [Schema.Types.ObjectId], ref: 'Work', default: [] },
    status: { type: String, enum: ['draft', 'published', 'withdrawn'], default: 'published' },
    likes: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    ratings: { type: [ratingSchema], default: [] },
    visits: { type: [visitSchema], default: [] },
    shareCount: { type: Number, default: 0 },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

exhibitionSchema.index({ ownerId: 1, createdAt: -1 })
exhibitionSchema.index({ status: 1, startDate: -1 })

export const ExhibitionModel = model<ExhibitionDocument>('Exhibition', exhibitionSchema)
