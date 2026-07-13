import { Schema, model } from 'mongoose'
import type { MiniAppDocument } from '@/types/models'

const miniAppPolicyContentSchema = new Schema(
  {
    title: { type: String, trim: true, default: '' },
    content: { type: String, default: '' },
    fileKey: { type: String, trim: true, default: '' },
    fileUrl: { type: String, trim: true, default: '' },
    generatedAt: { type: Date, default: null },
    version: { type: Number, default: 0 },
  },
  {
    _id: false,
  },
)

const miniAppBrandingSchema = new Schema(
  {
    appName: { type: String, trim: true, default: '' },
    logoUrl: { type: String, trim: true, default: '' },
    themeColor: { type: String, trim: true, default: '' },
  },
  { _id: false },
)

const miniAppRuntimeConfigSchema = new Schema(
  {
    features: { type: Schema.Types.Mixed, default: () => ({}) },
    values: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  { _id: false },
)

const miniAppSchema = new Schema<MiniAppDocument>(
  {
    appKey: { type: String, required: true, trim: true, unique: true },
    appType: { type: String, enum: ['tour', 'viewer'], required: true, default: 'tour' },
    name: { type: String, required: true, trim: true },
    enabled: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    branding: { type: miniAppBrandingSchema, default: () => ({}) },
    runtimeConfig: { type: miniAppRuntimeConfigSchema, default: () => ({}) },
    userServiceAgreement: {
      type: miniAppPolicyContentSchema,
      default: () => ({
        title: '用户服务协议',
        content: '',
        fileKey: '',
        fileUrl: '',
        generatedAt: null,
        version: 0,
      }),
    },
    privacyPolicy: {
      type: miniAppPolicyContentSchema,
      default: () => ({
        title: '隐私政策',
        content: '',
        fileKey: '',
        fileUrl: '',
        generatedAt: null,
        version: 0,
      }),
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
)

miniAppSchema.index({ appKey: 1 }, { unique: true })
miniAppSchema.index({ enabled: 1, isDefault: 1 })

export const MiniAppModel = model<MiniAppDocument>('MiniApp', miniAppSchema, 'mini_apps')
