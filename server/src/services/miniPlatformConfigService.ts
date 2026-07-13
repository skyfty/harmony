import { MiniAppModel } from '@/models/MiniApp'
import { MiniAppPlatformConfigModel } from '@/models/MiniAppPlatformConfig'
import type { MiniAppType, MiniPlatformKind } from '@/types/models'

export type MiniPlatformFeatureState = {
  enabled: boolean
  [key: string]: unknown
}

export type ResolvedMiniApp = {
  id: string
  appKey: string
  appType: MiniAppType
  name: string
  enabled: boolean
  isDefault: boolean
  branding: {
    appName: string
    logoUrl: string
    themeColor: string
  }
  runtimeConfig: {
    features: Record<string, boolean>
    values: Record<string, string | number | boolean | null>
  }
  userServiceAgreement: {
    title: string
    content: string
    fileKey: string
    fileUrl: string
    generatedAt: Date | null
    version: number
  }
  privacyPolicy: {
    title: string
    content: string
    fileKey: string
    fileUrl: string
    generatedAt: Date | null
    version: number
  }
}

export type ResolvedMiniAppPlatformConfig = {
  id: string
  appKey: string
  platform: MiniPlatformKind
  enabled: boolean
  appId: string
  appSecret: string
  loginConfig: MiniPlatformFeatureState & { scopes: string[] }
  paymentConfig: MiniPlatformFeatureState & {
    channel: string
    mchId: string
    serialNo: string
    privateKey: string
    apiV3Key: string
    notifyUrl: string
    refundNotifyUrl: string
    baseUrl: string
    platformPublicKey: string
    callbackSkipVerifyInDev: boolean
    mockPlatformPrivateKey: string
  }
  shareConfig: MiniPlatformFeatureState & {
    defaultPath: string
    defaultTitle: string
    posterEnabled: boolean
    qrCodeRuleLink: string
  }
  privacyConfig: MiniPlatformFeatureState & {
    requireConsentBeforeUse: boolean
  }
  updateConfig: MiniPlatformFeatureState & {
    promptMode: 'none' | 'soft' | 'force'
  }
  navigateConfig: MiniPlatformFeatureState & {
    landingPage: string
  }
  extConfig: Record<string, unknown>
}

function mapMiniApp(row: any): ResolvedMiniApp {
  return {
    id: row._id.toString(),
    appKey: String(row.appKey ?? '').trim(),
    appType: row.appType === 'viewer' ? 'viewer' : 'tour',
    name: String(row.name ?? '').trim(),
    enabled: row.enabled !== false,
    isDefault: row.isDefault === true,
    branding: {
      appName: String(row.branding?.appName ?? '').trim(),
      logoUrl: String(row.branding?.logoUrl ?? '').trim(),
      themeColor: String(row.branding?.themeColor ?? '').trim(),
    },
    runtimeConfig: {
      features: { ...(row.runtimeConfig?.features ?? {}) },
      values: { ...(row.runtimeConfig?.values ?? {}) },
    },
    userServiceAgreement: {
      title: String(row.userServiceAgreement?.title ?? '').trim(),
      content: String(row.userServiceAgreement?.content ?? ''),
      fileKey: String(row.userServiceAgreement?.fileKey ?? '').trim(),
      fileUrl: String(row.userServiceAgreement?.fileUrl ?? '').trim(),
      generatedAt: row.userServiceAgreement?.generatedAt ?? null,
      version: Number(row.userServiceAgreement?.version ?? 0) || 0,
    },
    privacyPolicy: {
      title: String(row.privacyPolicy?.title ?? '').trim(),
      content: String(row.privacyPolicy?.content ?? ''),
      fileKey: String(row.privacyPolicy?.fileKey ?? '').trim(),
      fileUrl: String(row.privacyPolicy?.fileUrl ?? '').trim(),
      generatedAt: row.privacyPolicy?.generatedAt ?? null,
      version: Number(row.privacyPolicy?.version ?? 0) || 0,
    },
  }
}

function mapPlatformConfig(row: any): ResolvedMiniAppPlatformConfig {
  return {
    id: row._id.toString(),
    appKey: String(row.appKey ?? '').trim(),
    platform: row.platform,
    enabled: row.enabled === true,
    appId: String(row.appId ?? '').trim(),
    appSecret: String(row.appSecret ?? ''),
    loginConfig: {
      enabled: row.loginConfig?.enabled === true,
      scopes: Array.isArray(row.loginConfig?.scopes) ? row.loginConfig.scopes.map((item: unknown) => String(item)) : [],
      ...(row.loginConfig?.extConfig ?? {}),
    },
    paymentConfig: {
      enabled: row.paymentConfig?.enabled === true,
      channel: String(row.paymentConfig?.channel ?? '').trim(),
      mchId: String(row.paymentConfig?.mchId ?? '').trim(),
      serialNo: String(row.paymentConfig?.serialNo ?? '').trim(),
      privateKey: String(row.paymentConfig?.privateKey ?? '').replace(/\\n/g, '\n'),
      apiV3Key: String(row.paymentConfig?.apiV3Key ?? '').trim(),
      notifyUrl: String(row.paymentConfig?.notifyUrl ?? '').trim(),
      refundNotifyUrl: String(row.paymentConfig?.refundNotifyUrl ?? '').trim(),
      baseUrl: String(row.paymentConfig?.baseUrl ?? 'https://api.mch.weixin.qq.com').trim(),
      platformPublicKey: String(row.paymentConfig?.platformPublicKey ?? '').replace(/\\n/g, '\n'),
      callbackSkipVerifyInDev: row.paymentConfig?.callbackSkipVerifyInDev === true,
      mockPlatformPrivateKey: String(row.paymentConfig?.mockPlatformPrivateKey ?? '').replace(/\\n/g, '\n'),
      ...(row.paymentConfig?.extConfig ?? {}),
    },
    shareConfig: {
      enabled: row.shareConfig?.enabled !== false,
      defaultPath: String(row.shareConfig?.defaultPath ?? '').trim(),
      defaultTitle: String(row.shareConfig?.defaultTitle ?? '').trim(),
      posterEnabled: row.shareConfig?.posterEnabled === true,
      qrCodeRuleLink: String(row.shareConfig?.qrCodeRuleLink ?? '').trim(),
      ...(row.shareConfig?.extConfig ?? {}),
    },
    privacyConfig: {
      enabled: row.privacyConfig?.enabled !== false,
      requireConsentBeforeUse: row.privacyConfig?.requireConsentBeforeUse !== false,
      ...(row.privacyConfig?.extConfig ?? {}),
    },
    updateConfig: {
      enabled: row.updateConfig?.enabled !== false,
      promptMode: row.updateConfig?.promptMode === 'force' ? 'force' : row.updateConfig?.promptMode === 'none' ? 'none' : 'soft',
      ...(row.updateConfig?.extConfig ?? {}),
    },
    navigateConfig: {
      enabled: row.navigateConfig?.enabled !== false,
      landingPage: String(row.navigateConfig?.landingPage ?? '').trim(),
      ...(row.navigateConfig?.extConfig ?? {}),
    },
    extConfig: { ...(row.extConfig ?? {}) },
  }
}

export async function listMiniAppsDetailed(filter?: { enabled?: boolean; keyword?: string }) {
  const query: Record<string, unknown> = {}
  if (typeof filter?.enabled === 'boolean') {
    query.enabled = filter.enabled
  }
  const keyword = String(filter?.keyword ?? '').trim()
  if (keyword) {
    query.$or = [{ appKey: new RegExp(keyword, 'i') }, { name: new RegExp(keyword, 'i') }]
  }

  const rows = await MiniAppModel.find(query).sort({ createdAt: -1 }).lean().exec()
  const apps = rows.map(mapMiniApp)
  const configs = await MiniAppPlatformConfigModel.find({ appKey: { $in: apps.map((item) => item.appKey) } }).lean().exec()
  const grouped = new Map<string, ResolvedMiniAppPlatformConfig[]>()

  configs.map(mapPlatformConfig).forEach((item) => {
    const list = grouped.get(item.appKey) ?? []
    list.push(item)
    grouped.set(item.appKey, list)
  })

  return apps.map((app) => ({
    ...app,
    platformConfigs: grouped.get(app.appKey) ?? [],
  }))
}

export async function resolveMiniApp(appKey?: string): Promise<ResolvedMiniApp> {
  const requestedAppKey = String(appKey ?? '').trim()
  if (requestedAppKey) {
    const found = await MiniAppModel.findOne({ appKey: requestedAppKey, enabled: true }).lean().exec()
    if (!found) {
      throw new Error('MiniApp not found or disabled')
    }
    return mapMiniApp(found)
  }

  const defaultApp = await MiniAppModel.findOne({ enabled: true, isDefault: true }).lean().exec()
  if (defaultApp) {
    return mapMiniApp(defaultApp)
  }

  const fallback = await MiniAppModel.findOne({ enabled: true }).sort({ createdAt: 1 }).lean().exec()
  if (fallback) {
    return mapMiniApp(fallback)
  }

  throw new Error('No enabled MiniApp configuration found')
}

export async function resolveMiniAppPlatformConfig(platform: MiniPlatformKind, appKey?: string): Promise<ResolvedMiniAppPlatformConfig> {
  const app = await resolveMiniApp(appKey)
  const row = await MiniAppPlatformConfigModel.findOne({
    appKey: app.appKey,
    platform,
  }).lean().exec()

  if (!row) {
    throw new Error('MiniApp platform config not found')
  }

  return mapPlatformConfig(row)
}

export async function listMiniAppPlatformConfigs(appKey: string): Promise<ResolvedMiniAppPlatformConfig[]> {
  const rows = await MiniAppPlatformConfigModel.find({ appKey: String(appKey ?? '').trim() }).lean().exec()
  return rows.map(mapPlatformConfig)
}

export async function listEnabledMiniAppPlatformConfigs(platform?: MiniPlatformKind): Promise<ResolvedMiniAppPlatformConfig[]> {
  const query: Record<string, unknown> = { enabled: true }
  if (platform) {
    query.platform = platform
  }
  const rows = await MiniAppPlatformConfigModel.find(query).lean().exec()
  return rows.map(mapPlatformConfig)
}
