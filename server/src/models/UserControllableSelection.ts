import { Schema, model } from 'mongoose'
import type { UserControllableSelectionDocument } from '@/types/models'

const userControllableSelectionSchema = new Schema<UserControllableSelectionDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    controllableType: { type: String, enum: ['vehicle', 'character', 'ship', 'aircraft'], required: true },
    controllableAssetId: { type: Schema.Types.ObjectId, ref: 'ControllableAsset', required: true },
  },
  { timestamps: true, versionKey: false },
)

userControllableSelectionSchema.index({ userId: 1, controllableType: 1 }, { unique: true })
userControllableSelectionSchema.index({ userId: 1, controllableAssetId: 1 })

export const UserControllableSelectionModel = model<UserControllableSelectionDocument>(
  'UserControllableSelection',
  userControllableSelectionSchema,
)
