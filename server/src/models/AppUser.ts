import { Schema, model } from 'mongoose'
import type { AppUserDocument } from '@/types/models'

const appUserSchema = new Schema<AppUserDocument>(
  {
    miniAppId: { type: String, trim: true },
    username: { type: String, trim: true },
    password: { type: String },
    wxOpenId: { type: String, trim: true },
    wxUnionId: { type: String, trim: true },
    displayName: { type: String },
    email: { type: String },
    avatarUrl: { type: String },
    phone: { type: String },
    bio: { type: String },
    gender: { type: String, enum: ['male', 'female', 'other'], default: undefined },
    birthDate: { type: Date },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    currentVehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', default: null },
    workShareCount: { type: Number, default: 0 },
    exhibitionShareCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

appUserSchema.index({ username: 1 }, { unique: true, sparse: true })
appUserSchema.index({ miniAppId: 1, wxOpenId: 1 }, { unique: true, sparse: true })
appUserSchema.index({ miniAppId: 1, wxUnionId: 1 }, { unique: true, sparse: true })

export const AppUserModel = model<AppUserDocument>('AppUser', appUserSchema, 'users')
