import { Schema, model } from 'mongoose'
import type { SceneSpotDocument } from '@/types/models'

const sceneSpotSchema = new Schema<SceneSpotDocument>(
  {
    sceneId: { type: Schema.Types.ObjectId, ref: 'Scene', required: true },
    category: { type: Schema.Types.ObjectId, ref: 'SceneSpotCategory', default: null },
    title: { type: String, required: true, trim: true },
    coverImage: { type: String, default: null },
    slides: { type: [String], default: [] },
    description: { type: String, default: '' },
    distance: { type: String, default: null },
    address: { type: String, default: '' },
    order: { type: Number, default: 0 },
    isHome: { type: Boolean, default: false },
    // denormalized flags for quick lookup
    isFeatured: { type: Boolean, default: false },
    isHot: { type: Boolean, default: false },
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
    favoriteCount: { type: Number, default: 0, min: 0 },
    ratingTotalScore: { type: Number, default: 0, min: 0 },
    phone: { type: String, default: null },
    // GeoJSON Point - only set when coordinates are provided
    location: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number] }, // [lng, lat]
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

sceneSpotSchema.index({ sceneId: 1, order: 1 })
sceneSpotSchema.index({ isHome: 1, order: 1, createdAt: -1 })
sceneSpotSchema.index({ isFeatured: 1 })
sceneSpotSchema.index({ isHot: 1 })
sceneSpotSchema.index({ title: 'text', description: 'text', address: 'text' })
// Use a sparse 2dsphere index so documents without a valid location are not indexed.
sceneSpotSchema.index({ location: '2dsphere' }, { sparse: true })

export const SceneSpotModel = model<SceneSpotDocument>('SceneSpot', sceneSpotSchema)
