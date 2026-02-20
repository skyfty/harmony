import { Schema, model } from 'mongoose'
import type { AdminPermissionDocument } from '@/types/models'

const adminPermissionSchema = new Schema<AdminPermissionDocument>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, trim: true },
    description: { type: String },
    group: { type: String },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

adminPermissionSchema.index({ code: 1 }, { unique: true })

export const AdminPermissionModel = model<AdminPermissionDocument>(
  'AdminPermission',
  adminPermissionSchema,
  'admin_permissions',
)
