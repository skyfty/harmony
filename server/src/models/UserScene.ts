import { Schema, model } from 'mongoose'
import type { UserSceneDocument } from '@/types/models'

const userSceneSchema = new Schema<UserSceneDocument>(
  {
    userId: { type: String, required: true, index: true },
    sceneId: { type: String, required: true },
    document: { type: Schema.Types.Mixed, required: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

userSceneSchema.index({ userId: 1, sceneId: 1 }, { unique: true })

export const UserSceneModel = model<UserSceneDocument>('UserScene', userSceneSchema)
