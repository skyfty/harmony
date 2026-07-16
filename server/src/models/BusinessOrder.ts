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
    rootOrderId: { type: Schema.Types.ObjectId, ref: 'BusinessOrder', default: null, index: true },
    parentOrderId: { type: Schema.Types.ObjectId, ref: 'BusinessOrder', default: null, index: true },
    orderKind: { type: String, enum: ['new', 'renewal'], default: 'new', index: true },
    promoterPhone: { type: String, default: null, trim: true, index: true },
    promoterUserId: { type: Schema.Types.ObjectId, ref: 'AppUser', default: null, index: true },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'processing', 'succeeded', 'failed', 'refunded', 'closed'],
      default: 'unpaid',
      index: true,
    },
    paymentMethod: { type: String, default: null },
    paymentProvider: { type: String, default: null },
    prepayId: { type: String, default: null },
    transactionId: { type: String, default: null },
    paidAt: { type: Date, default: null },
    paymentResult: { type: Schema.Types.Mixed, default: null },
    scenicName: { type: String, required: true, trim: true },
    addressText: { type: String, required: true, trim: true },
    location: { type: businessOrderLocationSchema, default: null },
    contactPhone: { type: String, required: true, trim: true },
    scenicArea: { type: Number, default: null, min: 0 },
    sceneSpotCategoryId: { type: Schema.Types.ObjectId, ref: 'SceneSpotCategory', default: null, index: true },
    specialLandscapeTags: { type: [String], default: [] },
    topStage: { type: String, enum: ['quote', 'signing', 'production', 'publish', 'operation'], default: 'quote', index: true },
    productionProgress: { type: [businessOrderProductionNodeSchema], default: [] },
    deliverySceneSpotId: { type: Schema.Types.ObjectId, ref: 'SceneSpot', default: null, index: true },
    deliverySceneId: { type: Schema.Types.ObjectId, ref: 'Scene', default: null, index: true },
    deliverySceneSpotTitle: { type: String, default: null, trim: true },
    deliveryBoundAt: { type: Date, default: null },
    contactPhoneForBusiness: { type: String, default: null },
    notes: { type: String, default: null },
    serviceDurationDays: { type: Number, default: 365, min: 1 },
    servicePrice: { type: Number, default: 0, min: 0 },
    serviceStartAt: { type: Date, default: null },
    serviceEndAt: { type: Date, default: null },
    serviceStatus: { type: String, enum: ['pending', 'active', 'expiring', 'expired'], default: 'pending', index: true },
    renewalWarningDays: { type: Number, default: 15, min: 1 },
    renewalCount: { type: Number, default: 0, min: 0 },
    lastRenewedAt: { type: Date, default: null },
    renewalApprovedAt: { type: Date, default: null },
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
businessOrderSchema.index({ rootOrderId: 1, createdAt: -1 })
businessOrderSchema.index({ parentOrderId: 1, createdAt: -1 })
businessOrderSchema.index({ userId: 1, parentOrderId: 1, createdAt: -1 })
businessOrderSchema.index({ promoterPhone: 1, createdAt: -1 })
businessOrderSchema.index({ promoterUserId: 1, createdAt: -1 })

export const BusinessOrderModel = model<BusinessOrderDocument>('BusinessOrder', businessOrderSchema)
