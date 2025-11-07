import { Schema, model } from 'mongoose'
import type { WorkRecordDocument } from '@/types/models'

const workRecordSchema = new Schema<WorkRecordDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workId: { type: Schema.Types.ObjectId, ref: 'Work', required: true, index: true },
    fileName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    mediaType: { type: String, enum: ['image', 'video', 'model', 'other'], default: 'image' },
    fileSize: { type: Number },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
)

workRecordSchema.index({ createdAt: -1 })

export const WorkRecordModel = model<WorkRecordDocument>('WorkRecord', workRecordSchema)
