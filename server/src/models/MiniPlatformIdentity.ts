import { Schema, model } from 'mongoose'
import type { MiniPlatformIdentityDocument } from '@/types/models'

const miniPlatformIdentitySchema = new Schema<MiniPlatformIdentityDocument>(
  {
    appKey: { type: String, required: true, trim: true },
    platform: { type: String, enum: ['wechat', 'douyin', 'xiaohongshu'], required: true },
    miniAppId: { type: String, required: true, trim: true },
    openId: { type: String, required: true, trim: true },
    unionId: { type: String, trim: true },
    userId: { type: Schema.Types.ObjectId, ref: 'AppUser', required: true, index: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
)

miniPlatformIdentitySchema.index({ appKey: 1, platform: 1, openId: 1 }, { unique: true })
miniPlatformIdentitySchema.index(
  { appKey: 1, platform: 1, unionId: 1 },
  { unique: true, partialFilterExpression: { unionId: { $type: 'string', $gt: '' } } },
)

export const MiniPlatformIdentityModel = model<MiniPlatformIdentityDocument>(
  'MiniPlatformIdentity',
  miniPlatformIdentitySchema,
  'mini_platform_identities',
)
