import { Schema, model } from 'mongoose'
import type { SceneDocument } from '@/types/models'

const sceneSchema = new Schema<SceneDocument>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    fileKey: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileSize: { type: Number, default: 0 },
    fileType: { type: String, default: null },
    originalFilename: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

sceneSchema.index({ name: 1 })
sceneSchema.index({ createdAt: -1 })

export const SceneModel = model<SceneDocument>('Scene', sceneSchema)
