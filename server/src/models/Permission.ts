import { Schema, model } from 'mongoose'
import type { PermissionDocument } from '@/types/models'

const permissionSchema = new Schema<PermissionDocument>(
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

permissionSchema.index({ code: 1 }, { unique: true })

export const PermissionModel = model<PermissionDocument>('Permission', permissionSchema)
