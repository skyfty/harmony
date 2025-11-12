import { AssetTypes } from '@harmony/schema/asset-types'
import { Schema, model } from 'mongoose'
import type { AssetDocument } from '@/types/models'

const assetSchema = new Schema<AssetDocument>(
  {
    name: { type: String, required: true, trim: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'AssetCategory', required: true },
    type: {
      type: String,
      enum: AssetTypes,
      required: true,
    },
    tags: {
      type: [{ type: Schema.Types.ObjectId, ref: 'AssetTag' }],
      default: [],
    },
    size: { type: Number, default: 0 },
    color: { type: String, default: null },
    dimensionLength: { type: Number, default: null },
    dimensionWidth: { type: Number, default: null },
    dimensionHeight: { type: Number, default: null },
    sizeCategory: { type: String, default: null },
    imageWidth: { type: Number, default: null },
    imageHeight: { type: Number, default: null },
    url: { type: String, required: true },
    fileKey: { type: String, required: true },
    previewUrl: { type: String },
    thumbnailUrl: { type: String },
    description: { type: String },
    originalFilename: { type: String },
    mimeType: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

assetSchema.index({ categoryId: 1, createdAt: -1 })
assetSchema.index({ type: 1, createdAt: -1 })
assetSchema.index({ tags: 1 })

export const AssetModel = model<AssetDocument>('Asset', assetSchema)
