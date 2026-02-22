import { Schema, model } from 'mongoose'
import type { UserSceneDocument } from '@/types/models'

const userSceneSchema = new Schema<UserSceneDocument>(
  {
    userId: { type: String, required: true, index: true },
    sceneId: { type: String, required: true },
    projectId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    thumbnail: { type: String, default: null },
    sceneCreatedAt: { type: Date, required: true },
    sceneUpdatedAt: { type: Date, required: true, index: true },

    bundleFileKey: { type: String, required: true },
    bundleFileSize: { type: Number, required: true },
    bundleFileType: { type: String, default: 'application/zip' },
    bundleOriginalFilename: { type: String, default: null },
    bundleEtag: { type: String, required: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

userSceneSchema.index({ userId: 1, sceneId: 1 }, { unique: true })
userSceneSchema.index({ userId: 1, sceneUpdatedAt: -1 })

export const UserSceneModel = model<UserSceneDocument>('UserScene', userSceneSchema)
