import { Schema, model } from 'mongoose'
import type { FileUploadDocument } from '@/types/models'

const fileUploadSchema = new Schema<FileUploadDocument>(
  {
    module: { type: String, required: true, trim: true, index: true },
    label: { type: String, default: null, trim: true },
    fileKey: { type: String, required: true, unique: true, index: true },
    url: { type: String, required: true },
    originalFilename: { type: String, default: null },
    mimeType: { type: String, default: null },
    size: { type: Number, required: true, min: 0, default: 0 },
    uploaderAdminId: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
    uploaderUsername: { type: String, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

fileUploadSchema.index({ module: 1, createdAt: -1 })
fileUploadSchema.index({ uploaderAdminId: 1, createdAt: -1 })

export const FileUploadModel = model<FileUploadDocument>('FileUpload', fileUploadSchema)