import { AssetTypes } from '@harmony/schema'
import { TerrainScatterCategories } from '@harmony/schema/terrain-scatter'
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
    seriesId: { type: Schema.Types.ObjectId, ref: 'AssetSeries', default: null },
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
    // Allow clearing the preset back to null while keeping valid enum values enforced
    terrainScatterPreset: { type: String, enum: [...TerrainScatterCategories, null], default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

assetSchema.index({ categoryId: 1, createdAt: -1 })
assetSchema.index({ type: 1, createdAt: -1 })
assetSchema.index({ tags: 1 })
assetSchema.index({ seriesId: 1 })
assetSchema.index({ terrainScatterPreset: 1 })

export const AssetModel = model<AssetDocument>('Asset', assetSchema)
