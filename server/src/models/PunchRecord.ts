import { Schema, model } from 'mongoose'
import type { PunchRecordDocument } from '@/types/models'

const punchRecordSchema = new Schema<PunchRecordDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'AppUser', required: true, index: true },
    username: { type: String, required: false },
    sceneId: { type: String, required: true, trim: true, index: true },
    scenicId: { type: String, required: true, trim: true, index: true },
    sceneName: { type: String, required: false, trim: true },
    nodeId: { type: String, required: true, trim: true, index: true },
    nodeName: { type: String, required: false, trim: true },
    clientPunchTime: { type: Date, required: false },
    behaviorPunchTime: { type: Date, required: false },
    source: { type: String, required: false, trim: true },
    path: { type: String, required: false, trim: true },
    ip: { type: String, required: false },
    userAgent: { type: String, required: false },
    metadata: { type: Schema.Types.Mixed, required: false },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

punchRecordSchema.index({ userId: 1, createdAt: -1 })
punchRecordSchema.index({ sceneId: 1, createdAt: -1 })
punchRecordSchema.index({ scenicId: 1, createdAt: -1 })
punchRecordSchema.index({ userId: 1, sceneId: 1, scenicId: 1, createdAt: -1 })
punchRecordSchema.index({ nodeId: 1, createdAt: -1 })
punchRecordSchema.index({ createdAt: -1 })

export const PunchRecordModel = model<PunchRecordDocument>('PunchRecord', punchRecordSchema)
