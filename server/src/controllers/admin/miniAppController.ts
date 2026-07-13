import type { Context } from 'koa'
import { MiniAppModel } from '@/models/MiniApp'
import { MiniAppPlatformConfigModel } from '@/models/MiniAppPlatformConfig'
import {
  getDefaultMiniAppPolicyContent,
  mapPolicyContent,
  normalizeMiniAppPolicyContent,
  syncMiniAppPolicyFiles,
} from '@/services/miniAppPolicyService'
import { listMiniAppPlatformConfigs, listMiniAppsDetailed } from '@/services/miniPlatformConfigService'
import type { MiniPlatformKind } from '@/types/models'

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function mapMiniAppPolicy(kind: 'user-service-agreement' | 'privacy-policy', row: any) {
  const fallback = getDefaultMiniAppPolicyContent(kind)
  const source = kind === 'user-service-agreement' ? row.userServiceAgreement : row.privacyPolicy
  return mapPolicyContent(kind, {
    title: source?.title || fallback.title,
    content: source?.content || fallback.content,
    fileKey: source?.fileKey ?? '',
    fileUrl: source?.fileUrl ?? '',
    generatedAt: source?.generatedAt ?? null,
    version: source?.version ?? 0,
  })
}

function normalizePlatform(value: unknown): MiniPlatformKind {
  const normalized = normalizeString(value).toLowerCase()
  if (normalized === 'douyin') {
    return 'douyin'
  }
  if (normalized === 'xiaohongshu') {
    return 'xiaohongshu'
  }
  return 'wechat'
}

function mapPlatformConfig(row: any) {
  return {
    id: row._id.toString(),
    appKey: row.appKey,
    platform: row.platform,
    enabled: row.enabled === true,
    appId: row.appId ?? '',
    appSecret: row.appSecret ?? '',
    loginConfig: {
      enabled: row.loginConfig?.enabled === true,
      scopes: Array.isArray(row.loginConfig?.scopes) ? row.loginConfig.scopes : [],
      extConfig: row.loginConfig?.extConfig ?? {},
    },
    paymentConfig: {
      enabled: row.paymentConfig?.enabled === true,
      channel: row.paymentConfig?.channel ?? '',
      mchId: row.paymentConfig?.mchId ?? '',
      serialNo: row.paymentConfig?.serialNo ?? '',
      privateKey: row.paymentConfig?.privateKey ?? '',
      apiV3Key: row.paymentConfig?.apiV3Key ?? '',
      notifyUrl: row.paymentConfig?.notifyUrl ?? '',
      refundNotifyUrl: row.paymentConfig?.refundNotifyUrl ?? '',
      baseUrl: row.paymentConfig?.baseUrl ?? 'https://api.mch.weixin.qq.com',
      platformPublicKey: row.paymentConfig?.platformPublicKey ?? '',
      callbackSkipVerifyInDev: row.paymentConfig?.callbackSkipVerifyInDev === true,
      mockPlatformPrivateKey: row.paymentConfig?.mockPlatformPrivateKey ?? '',
      extConfig: row.paymentConfig?.extConfig ?? {},
    },
    shareConfig: {
      enabled: row.shareConfig?.enabled !== false,
      defaultPath: row.shareConfig?.defaultPath ?? '',
      defaultTitle: row.shareConfig?.defaultTitle ?? '',
      posterEnabled: row.shareConfig?.posterEnabled === true,
      qrCodeRuleLink: row.shareConfig?.qrCodeRuleLink ?? '',
      extConfig: row.shareConfig?.extConfig ?? {},
    },
    privacyConfig: {
      enabled: row.privacyConfig?.enabled !== false,
      requireConsentBeforeUse: row.privacyConfig?.requireConsentBeforeUse !== false,
      extConfig: row.privacyConfig?.extConfig ?? {},
    },
    updateConfig: {
      enabled: row.updateConfig?.enabled !== false,
      promptMode: row.updateConfig?.promptMode ?? 'soft',
      extConfig: row.updateConfig?.extConfig ?? {},
    },
    navigateConfig: {
      enabled: row.navigateConfig?.enabled !== false,
      landingPage: row.navigateConfig?.landingPage ?? '',
      extConfig: row.navigateConfig?.extConfig ?? {},
    },
    extConfig: row.extConfig ?? {},
  }
}

function mapMiniApp(row: any, platformConfigs: any[] = []) {
  return {
    id: row._id?.toString?.() ?? row.id,
    appKey: row.appKey,
    appType: row.appType,
    name: row.name,
    enabled: row.enabled !== false,
    isDefault: row.isDefault === true,
    branding: {
      appName: row.branding?.appName ?? '',
      logoUrl: row.branding?.logoUrl ?? '',
      themeColor: row.branding?.themeColor ?? '',
    },
    runtimeConfig: {
      features: row.runtimeConfig?.features ?? {},
      values: row.runtimeConfig?.values ?? {},
    },
    userServiceAgreement: mapMiniAppPolicy('user-service-agreement', row),
    privacyPolicy: mapMiniAppPolicy('privacy-policy', row),
    platformConfigs,
    configuredPlatforms: platformConfigs.map((item) => item.platform),
    platformHealth: platformConfigs.reduce<Record<string, 'configured' | 'incomplete' | 'disabled'>>((result, item) => {
      result[item.platform] = item.enabled && item.appId && item.appSecret ? 'configured' : item.enabled ? 'incomplete' : 'disabled'
      return result
    }, {}),
    createdAt: row.createdAt?.toISOString?.() ?? new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt?.toISOString?.() ?? new Date(row.updatedAt).toISOString(),
  }
}

async function ensureDefaultConstraint(nextDefaultId?: string) {
  if (!nextDefaultId) {
    return
  }
  await MiniAppModel.updateMany({ _id: { $ne: nextDefaultId }, isDefault: true }, { $set: { isDefault: false } }).exec()
}

function pickPlatformPayload(body: Record<string, any>, platform: MiniPlatformKind) {
  const record = (body.platformConfigs?.[platform] ?? body.platformConfig ?? {}) as Record<string, any>
  return record
}

async function upsertPlatformConfig(appKey: string, platform: MiniPlatformKind, body: Record<string, any>) {
  const payload = pickPlatformPayload(body, platform)
  const row =
    (await MiniAppPlatformConfigModel.findOne({ appKey, platform }).exec())
    ?? new MiniAppPlatformConfigModel({ appKey, platform })

  row.enabled = payload.enabled === true
  row.appId = normalizeString(payload.appId)
  row.appSecret = typeof payload.appSecret === 'string' ? payload.appSecret : ''
  row.loginConfig = {
    enabled: payload.loginConfig?.enabled !== false,
    scopes: Array.isArray(payload.loginConfig?.scopes) ? payload.loginConfig.scopes.map((item: unknown) => String(item)) : [],
    extConfig: payload.loginConfig?.extConfig ?? {},
  } as any
  row.paymentConfig = {
    enabled: payload.paymentConfig?.enabled === true,
    channel: normalizeString(payload.paymentConfig?.channel) || 'wechat',
    mchId: normalizeString(payload.paymentConfig?.mchId),
    serialNo: normalizeString(payload.paymentConfig?.serialNo),
    privateKey: String(payload.paymentConfig?.privateKey ?? ''),
    apiV3Key: normalizeString(payload.paymentConfig?.apiV3Key),
    notifyUrl: normalizeString(payload.paymentConfig?.notifyUrl),
    refundNotifyUrl: normalizeString(payload.paymentConfig?.refundNotifyUrl),
    baseUrl: normalizeString(payload.paymentConfig?.baseUrl) || 'https://api.mch.weixin.qq.com',
    platformPublicKey: String(payload.paymentConfig?.platformPublicKey ?? ''),
    callbackSkipVerifyInDev: payload.paymentConfig?.callbackSkipVerifyInDev === true,
    mockPlatformPrivateKey: String(payload.paymentConfig?.mockPlatformPrivateKey ?? ''),
    extConfig: payload.paymentConfig?.extConfig ?? {},
  } as any
  row.shareConfig = {
    enabled: payload.shareConfig?.enabled !== false,
    defaultPath: normalizeString(payload.shareConfig?.defaultPath),
    defaultTitle: normalizeString(payload.shareConfig?.defaultTitle),
    posterEnabled: payload.shareConfig?.posterEnabled === true,
    qrCodeRuleLink: normalizeString(payload.shareConfig?.qrCodeRuleLink),
    extConfig: payload.shareConfig?.extConfig ?? {},
  } as any
  row.privacyConfig = {
    enabled: payload.privacyConfig?.enabled !== false,
    requireConsentBeforeUse: payload.privacyConfig?.requireConsentBeforeUse !== false,
    extConfig: payload.privacyConfig?.extConfig ?? {},
  } as any
  row.updateConfig = {
    enabled: payload.updateConfig?.enabled !== false,
    promptMode: payload.updateConfig?.promptMode === 'force' ? 'force' : payload.updateConfig?.promptMode === 'none' ? 'none' : 'soft',
    extConfig: payload.updateConfig?.extConfig ?? {},
  } as any
  row.navigateConfig = {
    enabled: payload.navigateConfig?.enabled !== false,
    landingPage: normalizeString(payload.navigateConfig?.landingPage),
    extConfig: payload.navigateConfig?.extConfig ?? {},
  } as any
  row.extConfig = payload.extConfig ?? {}
  await row.save()
  return row
}

export async function listMiniApps(ctx: Context): Promise<void> {
  const { keyword = '', enabled } = ctx.query as Record<string, string>
  const rows = await listMiniAppsDetailed({
    keyword,
    enabled: enabled === 'true' ? true : enabled === 'false' ? false : undefined,
  })
  ctx.body = rows.map((row) => mapMiniApp(row, row.platformConfigs))
}

export async function getMiniApp(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id?: string }
  const row = await MiniAppModel.findById(id).lean().exec()
  if (!row) {
    ctx.throw(404, 'MiniApp not found')
  }
  const platformConfigs = await listMiniAppPlatformConfigs(row.appKey)
  ctx.body = mapMiniApp(row, platformConfigs)
}

export async function createMiniApp(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as Record<string, any>
  const appKey = normalizeString(body.appKey)
  const name = normalizeString(body.name)
  const appType = normalizeString(body.appType) === 'viewer' ? 'viewer' : 'tour'
  if (!appKey || !name) {
    ctx.throw(400, 'appKey and name are required')
  }

  const exists = await MiniAppModel.findOne({ appKey }).lean().exec()
  if (exists) {
    ctx.throw(409, 'appKey already exists')
  }

  const created = await MiniAppModel.create({
    appKey,
    appType,
    name,
    enabled: body.enabled !== false,
    isDefault: body.isDefault === true,
    branding: {
      appName: normalizeString(body.branding?.appName),
      logoUrl: normalizeString(body.branding?.logoUrl),
      themeColor: normalizeString(body.branding?.themeColor),
    },
    runtimeConfig: {
      features: body.runtimeConfig?.features ?? {},
      values: body.runtimeConfig?.values ?? {},
    },
  })

  if (body.userServiceAgreement && typeof body.userServiceAgreement === 'object') {
    const agreement = normalizeMiniAppPolicyContent('user-service-agreement', body.userServiceAgreement)
    created.userServiceAgreement.title = agreement.title
    created.userServiceAgreement.content = agreement.content
  }
  if (body.privacyPolicy && typeof body.privacyPolicy === 'object') {
    const privacy = normalizeMiniAppPolicyContent('privacy-policy', body.privacyPolicy)
    created.privacyPolicy.title = privacy.title
    created.privacyPolicy.content = privacy.content
  }
  await created.save()
  await syncMiniAppPolicyFiles(created)

  for (const platform of ['wechat', 'douyin', 'xiaohongshu'] as const) {
    if (body.platformConfigs?.[platform]) {
      await upsertPlatformConfig(appKey, platform, body)
    }
  }

  if (created.isDefault) {
    await ensureDefaultConstraint(created._id.toString())
  }

  const platformConfigs = await listMiniAppPlatformConfigs(appKey)
  ctx.status = 201
  ctx.body = mapMiniApp(created, platformConfigs)
}

export async function updateMiniApp(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id?: string }
  const body = (ctx.request.body ?? {}) as Record<string, any>
  const row = await MiniAppModel.findById(id).exec()
  if (!row) {
    ctx.throw(404, 'MiniApp not found')
  }

  const name = normalizeString(body.name)
  if (name) {
    row.name = name
  }
  if (typeof body.appType === 'string') {
    row.appType = body.appType === 'viewer' ? 'viewer' : 'tour'
  }
  if (typeof body.enabled === 'boolean') {
    row.enabled = body.enabled
  }
  if (typeof body.isDefault === 'boolean') {
    row.isDefault = body.isDefault
  }

  if (body.branding && typeof body.branding === 'object') {
    row.branding = {
      appName: normalizeString(body.branding.appName),
      logoUrl: normalizeString(body.branding.logoUrl),
      themeColor: normalizeString(body.branding.themeColor),
    }
  }
  if (body.runtimeConfig && typeof body.runtimeConfig === 'object') {
    row.runtimeConfig = {
      features: body.runtimeConfig.features ?? {},
      values: body.runtimeConfig.values ?? {},
    }
  }
  if (body.userServiceAgreement && typeof body.userServiceAgreement === 'object') {
    const agreement = normalizeMiniAppPolicyContent('user-service-agreement', body.userServiceAgreement)
    row.userServiceAgreement.title = agreement.title
    row.userServiceAgreement.content = agreement.content
  }
  if (body.privacyPolicy && typeof body.privacyPolicy === 'object') {
    const privacy = normalizeMiniAppPolicyContent('privacy-policy', body.privacyPolicy)
    row.privacyPolicy.title = privacy.title
    row.privacyPolicy.content = privacy.content
  }

  await row.save()
  await syncMiniAppPolicyFiles(row)

  for (const platform of ['wechat', 'douyin', 'xiaohongshu'] as const) {
    if (body.platformConfigs?.[platform]) {
      await upsertPlatformConfig(row.appKey, platform, body)
    }
  }

  if (row.isDefault) {
    await ensureDefaultConstraint(row._id.toString())
  }

  const platformConfigs = await listMiniAppPlatformConfigs(row.appKey)
  ctx.body = mapMiniApp(row, platformConfigs)
}

export async function listMiniAppPlatforms(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id?: string }
  const row = await MiniAppModel.findById(id).lean().exec()
  if (!row) {
    ctx.throw(404, 'MiniApp not found')
  }
  const platformConfigs = await listMiniAppPlatformConfigs(row.appKey)
  ctx.body = platformConfigs
}

export async function updateMiniAppPlatform(ctx: Context): Promise<void> {
  const { id, platform } = ctx.params as { id?: string; platform?: string }
  const row = await MiniAppModel.findById(id).lean().exec()
  if (!row) {
    ctx.throw(404, 'MiniApp not found')
  }
  const normalizedPlatform = normalizePlatform(platform)
  const body = (ctx.request.body ?? {}) as Record<string, any>
  const saved = await upsertPlatformConfig(row.appKey, normalizedPlatform, {
    platformConfig: body,
  })
  ctx.body = mapPlatformConfig(saved)
}

export async function deleteMiniApp(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id?: string }
  const row = await MiniAppModel.findById(id).exec()
  if (!row) {
    ctx.throw(404, 'MiniApp not found')
  }
  if (row.isDefault) {
    ctx.throw(400, 'Default MiniApp cannot be deleted')
  }
  await MiniAppPlatformConfigModel.deleteMany({ appKey: row.appKey }).exec()
  await row.deleteOne()
  ctx.body = { success: true }
}
