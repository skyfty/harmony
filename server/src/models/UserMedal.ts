import { Schema, model } from 'mongoose'
import type { UserMedalDocument } from '@/types/models'

const userMedalSchema = new Schema<UserMedalDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'AppUser', required: true, index: true },
    medalId: { type: Schema.Types.ObjectId, ref: 'Medal', required: true, index: true },
    awardedAt: { type: Date, default: Date.now, required: true },
    triggerSource: { type: String, default: null, trim: true },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

userMedalSchema.index({ userId: 1, medalId: 1 }, { unique: true })
userMedalSchema.index({ userId: 1, awardedAt: -1 })

export const UserMedalModel = model<UserMedalDocument>('UserMedal', userMedalSchema)