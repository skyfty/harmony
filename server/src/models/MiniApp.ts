import { Schema, model } from 'mongoose'
import type { MiniAppDocument } from '@/types/models'

const miniAppWechatPaySchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    mchId: { type: String, trim: true, default: '' },
    serialNo: { type: String, trim: true, default: '' },
    privateKey: { type: String, default: '' },
    apiV3Key: { type: String, trim: true, default: '' },
    notifyUrl: { type: String, trim: true, default: '' },
    baseUrl: { type: String, trim: true, default: 'https://api.mch.weixin.qq.com' },
    platformPublicKey: { type: String, default: '' },
    callbackSkipVerifyInDev: { type: Boolean, default: false },
    mockPlatformPrivateKey: { type: String, default: '' },
  },
  {
    _id: false,
  },
)

const miniAppSchema = new Schema<MiniAppDocument>(
  {
    miniAppId: { type: String, required: true, trim: true, unique: true },
    name: { type: String, required: true, trim: true },
    appSecret: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    wechatPay: { type: miniAppWechatPaySchema, default: () => ({ enabled: false }) },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

miniAppSchema.index({ miniAppId: 1 }, { unique: true })
miniAppSchema.index({ enabled: 1, isDefault: 1 })

export const MiniAppModel = model<MiniAppDocument>('MiniApp', miniAppSchema, 'mini_apps')
