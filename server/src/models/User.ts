import { Schema, model } from 'mongoose'
import type { UserDocument } from '@/types/models'

const userSchema = new Schema<UserDocument>(
  {
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    displayName: { type: String },
    email: { type: String },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    roles: [{ type: Schema.Types.ObjectId, ref: 'Role' }],
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

userSchema.index({ username: 1 }, { unique: true })

export const UserModel = model<UserDocument>('User', userSchema)
