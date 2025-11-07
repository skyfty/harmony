import { Schema, model } from 'mongoose'
import type { WorkCollectionDocument } from '@/types/models'

const workCollectionSchema = new Schema<WorkCollectionDocument>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    coverUrl: { type: String },
    workIds: { type: [Schema.Types.ObjectId], ref: 'Work', default: [] },
    isPublic: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

workCollectionSchema.index({ ownerId: 1, createdAt: -1 })

export const WorkCollectionModel = model<WorkCollectionDocument>('WorkCollection', workCollectionSchema)
