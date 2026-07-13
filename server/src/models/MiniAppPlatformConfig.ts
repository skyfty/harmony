import { Schema, model } from 'mongoose'
import type { MiniAppPlatformConfigDocument } from '@/types/models'

function createFeatureConfigSchema() {
  return new Schema(
    {
      enabled: { type: Boolean, default: false },
      extConfig: { type: Schema.Types.Mixed, default: () => ({}) },
    },
    { _id: false },
  )
}

const loginConfigSchema = createFeatureConfigSchema()

loginConfigSchema.add({
  scopes: { type: [String], default: [] },
})

const paymentConfigSchema = createFeatureConfigSchema()
paymentConfigSchema.add({
  channel: { type: String, trim: true, default: '' },
  mchId: { type: String, trim: true, default: '' },
  serialNo: { type: String, trim: true, default: '' },
  privateKey: { type: String, default: '' },
  apiV3Key: { type: String, trim: true, default: '' },
  notifyUrl: { type: String, trim: true, default: '' },
  refundNotifyUrl: { type: String, trim: true, default: '' },
  baseUrl: { type: String, trim: true, default: 'https://api.mch.weixin.qq.com' },
  platformPublicKey: { type: String, default: '' },
  callbackSkipVerifyInDev: { type: Boolean, default: false },
  mockPlatformPrivateKey: { type: String, default: '' },
})

const shareConfigSchema = createFeatureConfigSchema()
shareConfigSchema.add({
  defaultPath: { type: String, trim: true, default: '' },
  defaultTitle: { type: String, trim: true, default: '' },
  posterEnabled: { type: Boolean, default: false },
  qrCodeRuleLink: { type: String, trim: true, default: '' },
})

const privacyConfigSchema = createFeatureConfigSchema()
privacyConfigSchema.add({
  requireConsentBeforeUse: { type: Boolean, default: true },
})

const updateConfigSchema = createFeatureConfigSchema()
updateConfigSchema.add({
  promptMode: { type: String, enum: ['none', 'soft', 'force'], default: 'soft' },
})

const navigateConfigSchema = createFeatureConfigSchema()
navigateConfigSchema.add({
  landingPage: { type: String, trim: true, default: '' },
})

const miniAppPlatformConfigSchema = new Schema<MiniAppPlatformConfigDocument>(
  {
    appKey: { type: String, required: true, trim: true },
    platform: { type: String, enum: ['wechat', 'douyin', 'xiaohongshu'], required: true },
    enabled: { type: Boolean, default: false },
    appId: { type: String, trim: true, default: '' },
    appSecret: { type: String, default: '' },
    loginConfig: { type: loginConfigSchema, default: () => ({ enabled: true, scopes: [] }) },
    paymentConfig: { type: paymentConfigSchema, default: () => ({ enabled: false, channel: 'wechat' }) },
    shareConfig: { type: shareConfigSchema, default: () => ({ enabled: true }) },
    privacyConfig: { type: privacyConfigSchema, default: () => ({ enabled: true, requireConsentBeforeUse: true }) },
    updateConfig: { type: updateConfigSchema, default: () => ({ enabled: true, promptMode: 'soft' }) },
    navigateConfig: { type: navigateConfigSchema, default: () => ({ enabled: true }) },
    extConfig: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

miniAppPlatformConfigSchema.index({ appKey: 1, platform: 1 }, { unique: true })
miniAppPlatformConfigSchema.index({ platform: 1, enabled: 1 })

export const MiniAppPlatformConfigModel = model<MiniAppPlatformConfigDocument>(
  'MiniAppPlatformConfig',
  miniAppPlatformConfigSchema,
  'mini_app_platform_configs',
)
