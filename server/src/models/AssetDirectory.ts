import { Schema, model } from 'mongoose'
import type { AssetDirectoryDocument } from '@/types/models'

export function normalizeDirectoryName(name: string): string {
  return name.trim().toLowerCase()
}

const assetDirectorySchema = new Schema<AssetDirectoryDocument>(
  {
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true, trim: true, lowercase: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'AssetDirectory', default: null },
    depth: { type: Number, required: true, default: 0, min: 0 },
    pathIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'AssetDirectory' }],
      required: true,
      default: [],
    },
    pathNames: {
      type: [String],
      required: true,
      default: [],
    },
    rootId: { type: Schema.Types.ObjectId, ref: 'AssetDirectory', required: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

assetDirectorySchema.pre('validate', function preValidate(next) {
  if (typeof this.name === 'string') {
    this.normalizedName = normalizeDirectoryName(this.name)
  }
  if (!Array.isArray(this.pathIds) || !this.pathIds.length) {
    this.pathIds = [this._id]
  }
  if (!Array.isArray(this.pathNames) || !this.pathNames.length) {
    this.pathNames = [this.name]
  }
  if (!this.rootId) {
    this.rootId = this.pathIds[0] ?? this._id
  }
  if (typeof this.depth !== 'number') {
    this.depth = Math.max(this.pathIds.length - 1, 0)
  }
  next()
})

assetDirectorySchema.pre('save', function preSave(next) {
  if (typeof this.name === 'string') {
    this.normalizedName = normalizeDirectoryName(this.name)
  }
  next()
})

assetDirectorySchema.index({ parentId: 1, normalizedName: 1 }, { unique: true })
assetDirectorySchema.index({ pathIds: 1 })
assetDirectorySchema.index({ rootId: 1 })
assetDirectorySchema.index({ normalizedName: 1 })

export const AssetDirectoryModel = model<AssetDirectoryDocument>('AssetDirectory', assetDirectorySchema)
