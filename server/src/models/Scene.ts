import { Schema, model } from 'mongoose'
import type { SceneDocument } from '@/types/models'

const sceneSchema = new Schema<SceneDocument>(
  {
    name: { type: String, required: true, trim: true },
    fileKey: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileSize: { type: Number, required: true, min: 0 },
    fileType: { type: String, default: null },
    originalFilename: { type: String, default: null },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

sceneSchema.index({ name: 1 })
sceneSchema.index({ createdAt: -1 })
sceneSchema.index({ publishedBy: 1, createdAt: -1 })

export const SceneModel = model<SceneDocument>('Scene', sceneSchema)
