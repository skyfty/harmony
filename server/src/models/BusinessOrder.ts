import { Schema, model } from 'mongoose'
import type { BusinessOrderDocument } from '@/types/models'

const businessOrderLocationSchema = new Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
  },
  { _id: false },
)

const businessOrderProductionNodeSchema = new Schema(
  {
    code: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    status: { type: String, enum: ['pending', 'active', 'completed'], default: 'pending' },
    activatedAt: { type: Date, default: null },
    remark: { type: String, default: null },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
)

const businessOrderSchema = new Schema<BusinessOrderDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'AppUser', required: true, index: true },
    orderNumber: { type: String, required: true, unique: true, index: true },
    scenicName: { type: String, required: true, trim: true },
    addressText: { type: String, required: true, trim: true },
    location: { type: businessOrderLocationSchema, default: null },
    contactPhone: { type: String, required: true, trim: true },
    scenicArea: { type: Number, default: null, min: 0 },
    sceneSpotCategoryId: { type: Schema.Types.ObjectId, ref: 'SceneSpotCategory', default: null, index: true },
    specialLandscapeTags: { type: [String], default: [] },
    topStage: { type: String, enum: ['quote', 'signing', 'production', 'publish', 'operation'], default: 'quote', index: true },
    productionProgress: { type: [businessOrderProductionNodeSchema], default: [] },
    contactPhoneForBusiness: { type: String, default: null },
    notes: { type: String, default: null },
    quotedAt: { type: Date, default: null },
    signedAt: { type: Date, default: null },
    productionStartedAt: { type: Date, default: null },
    productionCompletedAt: { type: Date, default: null },
    publishReadyAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    operatingAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

businessOrderSchema.index({ userId: 1, createdAt: -1 })
businessOrderSchema.index({ topStage: 1, createdAt: -1 })

export const BusinessOrderModel = model<BusinessOrderDocument>('BusinessOrder', businessOrderSchema)