import { Schema, model } from 'mongoose'
import type { UserSkinSelectionDocument } from '@/types/models'

const userSkinSelectionSchema = new Schema<UserSkinSelectionDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    skinCategoryId: { type: Schema.Types.ObjectId, ref: 'SkinCategory', required: true },
    skinId: { type: Schema.Types.ObjectId, ref: 'Skin', required: true },
  },
  { timestamps: true, versionKey: false },
)

userSkinSelectionSchema.index({ userId: 1, skinCategoryId: 1 }, { unique: true })
userSkinSelectionSchema.index({ userId: 1, skinId: 1 })

export const UserSkinSelectionModel = model<UserSkinSelectionDocument>('UserSkinSelection', userSkinSelectionSchema)
