import { Schema, model } from 'mongoose'
import type { AssetTagDocument } from '@/types/models'

const assetTagSchema = new Schema<AssetTagDocument>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: '' },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

assetTagSchema.index({ name: 1 }, { unique: true })

export const AssetTagModel = model<AssetTagDocument>('AssetTag', assetTagSchema)
