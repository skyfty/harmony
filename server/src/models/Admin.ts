import { Schema, model } from 'mongoose'
import type { AdminDocument } from '@/types/models'

const adminSchema = new Schema<AdminDocument>(
  {
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    displayName: { type: String },
    email: { type: String },
    avatarUrl: { type: String },
    phone: { type: String },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    roles: [{ type: Schema.Types.ObjectId, ref: 'AdminRole' }],
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

adminSchema.index({ username: 1 }, { unique: true })

export const AdminModel = model<AdminDocument>('Admin', adminSchema, 'admins')
