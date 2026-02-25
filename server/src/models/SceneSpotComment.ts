import { Schema, model } from 'mongoose'
import type { SceneSpotCommentDocument } from '@/types/models'

const sceneSpotCommentSchema = new Schema<SceneSpotCommentDocument>(
  {
    sceneSpotId: { type: Schema.Types.ObjectId, ref: 'SceneSpot', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'AppUser', required: true, index: true },
    content: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    rejectReason: { type: String, default: null, trim: true },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
    editedAt: { type: Date, default: null },
    editedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

sceneSpotCommentSchema.index({ sceneSpotId: 1, status: 1, createdAt: -1 })
sceneSpotCommentSchema.index({ userId: 1, createdAt: -1 })
sceneSpotCommentSchema.index({ status: 1, createdAt: -1 })

export const SceneSpotCommentModel = model<SceneSpotCommentDocument>('SceneSpotComment', sceneSpotCommentSchema)
