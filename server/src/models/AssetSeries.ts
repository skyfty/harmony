import { Schema, model } from 'mongoose'
import type { AssetSeriesDocument } from '@/types/models'

const assetSeriesSchema = new Schema<AssetSeriesDocument>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: null, trim: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

assetSeriesSchema.index({ name: 1 }, { unique: true })

export const AssetSeriesModel = model<AssetSeriesDocument>('AssetSeries', assetSeriesSchema)
