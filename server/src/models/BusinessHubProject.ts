import { Schema, model } from 'mongoose'
import type { BusinessHubProjectDocument } from '@/types/models'

const businessHubTaskSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    status: { type: String, enum: ['todo', 'doing', 'done', 'blocked'], default: 'todo', index: true },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium', index: true },
    assignee: { type: String, default: null, trim: true },
    dueAt: { type: Date, default: null },
    remark: { type: String, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

const businessHubReminderSchema = new Schema(
  {
    kind: {
      type: String,
      enum: ['service-expiring', 'service-expired', 'delivery-blocked', 'workflow-note', 'custom'],
      default: 'custom',
      index: true,
    },
    title: { type: String, required: true, trim: true },
    message: { type: String, default: null },
    status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    dueAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

const businessHubMaterialSchema = new Schema(
  {
    kind: { type: String, enum: ['poster', 'qrcode', 'copy', 'link', 'file'], default: 'copy', index: true },
    title: { type: String, required: true, trim: true },
    content: { type: String, default: null },
    url: { type: String, default: null, trim: true },
    fileUrl: { type: String, default: null, trim: true },
  },
  { timestamps: true },
)

const businessHubApprovalSchema = new Schema(
  {
    kind: {
      type: String,
      enum: ['quote', 'signing', 'delivery', 'publish', 'renewal', 'custom'],
      default: 'custom',
      index: true,
    },
    title: { type: String, required: true, trim: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    remark: { type: String, default: null },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

const businessHubRenewalSchema = new Schema(
  {
    renewalNumber: { type: String, required: true, trim: true, index: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'processing', 'succeeded', 'failed', 'refunded', 'closed'],
      default: 'unpaid',
      index: true,
    },
    durationDays: { type: Number, default: 365, min: 1 },
    price: { type: Number, default: 0, min: 0 },
    serviceStartAt: { type: Date, default: null },
    serviceEndAt: { type: Date, default: null },
    requestedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    remark: { type: String, default: null },
  },
  { timestamps: true },
)

const businessHubActivitySchema = new Schema(
  {
    action: { type: String, required: true, trim: true },
    actorType: { type: String, enum: ['admin', 'system'], default: 'system', index: true },
    actorName: { type: String, default: null, trim: true },
    content: { type: String, required: true, trim: true },
  },
  { timestamps: true },
)

const businessHubProjectSchema = new Schema<BusinessHubProjectDocument>(
  {
    projectNumber: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true },
    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, required: true, trim: true },
    sourceChannel: { type: String, default: null, trim: true },
    summary: { type: String, default: null },
    notes: { type: String, default: null },
    stage: { type: String, enum: ['lead', 'quote', 'signing', 'production', 'publish', 'operation'], default: 'lead', index: true },
    status: { type: String, enum: ['active', 'paused', 'completed', 'archived'], default: 'active', index: true },
    contractStatus: { type: String, enum: ['unsigned', 'signed'], default: 'unsigned', index: true },
    serviceStatus: { type: String, enum: ['pending', 'active', 'expiring', 'expired'], default: 'pending', index: true },
    serviceDurationDays: { type: Number, default: 365, min: 1 },
    servicePrice: { type: Number, default: 0, min: 0 },
    serviceStartAt: { type: Date, default: null },
    serviceEndAt: { type: Date, default: null },
    renewalWarningDays: { type: Number, default: 15, min: 1 },
    deliverySceneId: { type: Schema.Types.ObjectId, ref: 'Scene', default: null, index: true },
    deliverySceneSpotId: { type: Schema.Types.ObjectId, ref: 'SceneSpot', default: null, index: true },
    deliverySceneSpotTitle: { type: String, default: null, trim: true },
    deliveryBoundAt: { type: Date, default: null },
    tasks: { type: [businessHubTaskSchema], default: [] },
    reminders: { type: [businessHubReminderSchema], default: [] },
    materials: { type: [businessHubMaterialSchema], default: [] },
    approvals: { type: [businessHubApprovalSchema], default: [] },
    renewals: { type: [businessHubRenewalSchema], default: [] },
    activityLogs: { type: [businessHubActivitySchema], default: [] },
    analyticsSnapshot: {
      todayUv: { type: Number, default: 0 },
      todayNewUsers: { type: Number, default: 0 },
      totalUv: { type: Number, default: 0 },
      totalPunchCount: { type: Number, default: 0 },
      updatedAt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

businessHubProjectSchema.index({ customerName: 1, createdAt: -1 })
businessHubProjectSchema.index({ stage: 1, createdAt: -1 })
businessHubProjectSchema.index({ status: 1, createdAt: -1 })
businessHubProjectSchema.index({ serviceStatus: 1, createdAt: -1 })

export const BusinessHubProjectModel = model<BusinessHubProjectDocument>('BusinessHubProject', businessHubProjectSchema)
