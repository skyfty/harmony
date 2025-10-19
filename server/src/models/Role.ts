import { Schema, model } from 'mongoose'
import type { RoleDocument } from '@/types/models'

const roleSchema = new Schema<RoleDocument>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, trim: true },
    description: { type: String },
    permissions: [{ type: Schema.Types.ObjectId, ref: 'Permission' }],
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

roleSchema.index({ code: 1 }, { unique: true })

export const RoleModel = model<RoleDocument>('Role', roleSchema)
