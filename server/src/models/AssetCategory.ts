import { Schema, model } from 'mongoose'
import type { AssetCategoryDocument } from '@/types/models'

export function normalizeCategoryName(name: string): string {
  return name.trim().toLowerCase()
}

const assetCategorySchema = new Schema<AssetCategoryDocument>(
  {
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String },
    parentId: { type: Schema.Types.ObjectId, ref: 'AssetCategory', default: null },
    depth: { type: Number, required: true, default: 0, min: 0 },
    pathIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'AssetCategory' }],
      required: true,
      default: [],
    },
    pathNames: {
      type: [String],
      required: true,
      default: [],
    },
    rootId: { type: Schema.Types.ObjectId, ref: 'AssetCategory', required: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

assetCategorySchema.pre('validate', function preValidate(next) {
  if (typeof this.name === 'string') {
    this.normalizedName = normalizeCategoryName(this.name)
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

assetCategorySchema.pre('save', function preSave(next) {
  if (typeof this.name === 'string') {
    this.normalizedName = normalizeCategoryName(this.name)
  }
  next()
})

assetCategorySchema.index({ parentId: 1, normalizedName: 1 }, { unique: true })
assetCategorySchema.index({ pathIds: 1 })
assetCategorySchema.index({ rootId: 1 })
assetCategorySchema.index({ normalizedName: 1 })

export const AssetCategoryModel = model<AssetCategoryDocument>('AssetCategory', assetCategorySchema)
