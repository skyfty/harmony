import { Schema, model } from 'mongoose'
import type { UserProjectDocument } from '@/types/models'

const userProjectSchema = new Schema<UserProjectDocument>(
  {
    userId: { type: String, required: true, index: true },
    projectId: { type: String, required: true },
    categoryId: { type: String, required: false, default: null, index: true },
    sceneIds: { type: [String], required: true, default: [] },
    document: { type: Schema.Types.Mixed, required: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

userProjectSchema.index({ userId: 1, projectId: 1 }, { unique: true })

export const UserProjectModel = model<UserProjectDocument>('UserProject', userProjectSchema)
