import { Schema, model } from 'mongoose'
import type { AnalyticsEventDocument } from '@/types/models'

const analyticsEventSchema = new Schema<AnalyticsEventDocument>(
  {
    eventType: { type: String, required: true, trim: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    sceneId: { type: Schema.Types.ObjectId, ref: 'Scene', default: null, index: true },
    sceneSpotId: { type: Schema.Types.ObjectId, ref: 'SceneSpot', default: null, index: true },
    sessionId: { type: String, default: '', index: true },
    source: { type: String, default: '', index: true },
    device: { type: String, default: '', index: true },
    path: { type: String, default: '' },
    dwellMs: { type: Number, min: 0, default: 0 },
    metadata: { type: Schema.Types.Mixed, default: null },
    occurredAt: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

analyticsEventSchema.index({ eventType: 1, occurredAt: -1 })
analyticsEventSchema.index({ sceneSpotId: 1, occurredAt: -1 })
analyticsEventSchema.index({ sceneId: 1, occurredAt: -1 })
analyticsEventSchema.index({ source: 1, occurredAt: -1 })
analyticsEventSchema.index({ device: 1, occurredAt: -1 })
analyticsEventSchema.index({ userId: 1, occurredAt: -1 })

export const AnalyticsEventModel = model<AnalyticsEventDocument>('AnalyticsEvent', analyticsEventSchema)
