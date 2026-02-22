import { Schema, model } from 'mongoose'
import type { TravelRecordDocument } from '@/types/models'

const travelRecordSchema = new Schema<TravelRecordDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'AppUser', required: true, index: true },
    username: { type: String, required: false },
    sceneId: { type: String, required: true, trim: true, index: true },
    scenicId: { type: String, required: true, trim: true, index: true },
    sceneName: { type: String, required: false, trim: true },
    enterTime: { type: Date, required: true, index: true },
    leaveTime: { type: Date, required: false, default: null },
    durationSeconds: { type: Number, required: false, default: null, min: 0 },
    status: { type: String, enum: ['active', 'completed'], default: 'active', index: true },
    source: { type: String, required: false, trim: true },
    path: { type: String, required: false, trim: true },
    ip: { type: String, required: false },
    userAgent: { type: String, required: false },
    metadata: { type: Schema.Types.Mixed, required: false, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

travelRecordSchema.index({ userId: 1, enterTime: -1 })
travelRecordSchema.index({ sceneId: 1, enterTime: -1 })
travelRecordSchema.index({ scenicId: 1, enterTime: -1 })
travelRecordSchema.index({ userId: 1, sceneId: 1, enterTime: -1 })
travelRecordSchema.index({ userId: 1, sceneId: 1, scenicId: 1, status: 1, leaveTime: 1, enterTime: -1 })
travelRecordSchema.index({ status: 1, updatedAt: -1 })
travelRecordSchema.index({ createdAt: -1 })

export const TravelRecordModel = model<TravelRecordDocument>('TravelRecord', travelRecordSchema)
