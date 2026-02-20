import { Schema, model } from 'mongoose'
import type { AdminRoleDocument } from '@/types/models'

const adminRoleSchema = new Schema<AdminRoleDocument>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, trim: true },
    description: { type: String },
    permissions: [{ type: Schema.Types.ObjectId, ref: 'AdminPermission' }],
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

adminRoleSchema.index({ code: 1 }, { unique: true })

export const AdminRoleModel = model<AdminRoleDocument>('AdminRole', adminRoleSchema, 'admin_roles')
