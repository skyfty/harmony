import { Schema, model } from 'mongoose'
import type { LoginAuditDocument } from '@/types/models'

const loginAuditSchema = new Schema<LoginAuditDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    username: { type: String, required: false, index: false },
    action: { type: String, required: true, default: 'login' },
    success: { type: Boolean, required: true, default: true },
    ip: { type: String, required: false },
    userAgent: { type: String, required: false },
    device: { type: String, required: false },
    note: { type: String, required: false },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

// Indexes for common queries
loginAuditSchema.index({ userId: 1, createdAt: -1 })
loginAuditSchema.index({ username: 1, createdAt: -1 })
loginAuditSchema.index({ ip: 1, createdAt: -1 })
loginAuditSchema.index({ createdAt: -1 })

// TTL: 365 days retention (configurable in future)
loginAuditSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 3600 })

export const LoginAuditModel = model<LoginAuditDocument>('LoginAudit', loginAuditSchema)
