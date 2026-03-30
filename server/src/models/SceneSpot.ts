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
    isFeatured: { type: Boolean, default: false },
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
    favoriteCount: { type: Number, default: 0, min: 0 },
    ratingTotalScore: { type: Number, default: 0, min: 0 },
    phone: { type: String, default: null },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: undefined }, // [lng, lat]
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

sceneSpotSchema.index({ sceneId: 1, order: 1 })
sceneSpotSchema.index({ isFeatured: 1, order: 1, createdAt: -1 })
sceneSpotSchema.index({ title: 'text', description: 'text', address: 'text' })
sceneSpotSchema.index({ location: '2dsphere' })

export const SceneSpotModel = model<SceneSpotDocument>('SceneSpot', sceneSpotSchema)
