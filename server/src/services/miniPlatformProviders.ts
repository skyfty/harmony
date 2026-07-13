import { createOrderPayment, type PaymentResult } from '@/services/paymentService'
import { resolveMiniAppPlatformConfig } from '@/services/miniPlatformConfigService'
import { exchangeMiniProgramCode } from '@/services/wechatMiniAuthService'
import { exchangeMiniProgramPhoneCode } from '@/services/wechatMiniUserService'
import type { MiniPlatformKind } from '@/types/models'

export interface MiniPlatformAuthProvider {
  platform: MiniPlatformKind
  exchangeCode(input: { appKey?: string; code: string }): Promise<{
    appKey?: string
    platform: MiniPlatformKind
    miniAppId?: string
    openId: string
    unionId?: string
  }>
  exchangePhoneCode?(input: { appKey?: string; code: string }): Promise<{
    phoneNumber: string
    purePhoneNumber: string
    countryCode?: string
  }>
}

export interface MiniPlatformPaymentProvider {
  platform: MiniPlatformKind
  createPayment(input: {
    appKey?: string
    orderNumber: string
    description: string
    amount: number
    openId: string
    attach?: string
  }): Promise<PaymentResult>
}

export interface MiniPlatformPrivacyProvider {
  platform: MiniPlatformKind
  acceptConsent(input: { appKey?: string; userId?: string; payload?: Record<string, unknown> }): Promise<{ accepted: boolean }>
}

async function exchangeMiniPlatformCodeByHttp(input: {
  appKey?: string
  code: string
  platform: MiniPlatformKind
  endpoint: string
  appIdKey: 'appid' | 'app_id'
  appSecretKey: 'secret' | 'app_secret'
}): Promise<{
  appKey?: string
  platform: MiniPlatformKind
  miniAppId?: string
  openId: string
  unionId?: string
}> {
  const platformConfig = await resolveMiniAppPlatformConfig(input.platform, input.appKey)
  if (!platformConfig.enabled) {
    throw new Error(`Platform auth is disabled for ${input.platform}`)
  }
  if (!platformConfig.appId || !platformConfig.appSecret) {
    throw new Error(`Missing platform app credentials for ${input.platform}`)
  }

  const url = new URL(input.endpoint)
  url.searchParams.set('code', input.code)
  url.searchParams.set(input.appIdKey, platformConfig.appId)
  url.searchParams.set(input.appSecretKey, platformConfig.appSecret)

  const response = await fetch(url.toString(), { method: 'GET' })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      typeof payload === 'object' && payload && 'message' in payload
        ? String((payload as Record<string, unknown>).message)
        : `Platform auth request failed for ${input.platform}`,
    )
  }

  const openId = String(
    payload?.open_id
    ?? payload?.openid
    ?? payload?.data?.open_id
    ?? payload?.data?.openid
    ?? '',
  ).trim()
  if (!openId) {
    throw new Error(`Platform auth response missing openId for ${input.platform}`)
  }

  return {
    appKey: platformConfig.appKey,
    platform: input.platform,
    miniAppId: platformConfig.appId,
    openId,
    unionId: String(payload?.union_id ?? payload?.unionid ?? payload?.data?.union_id ?? payload?.data?.unionid ?? '').trim() || undefined,
  }
}

const wechatAuthProvider: MiniPlatformAuthProvider = {
  platform: 'wechat',
  async exchangeCode(input) {
    const identity = await exchangeMiniProgramCode(input.code, input.appKey, 'wechat')
    return {
      appKey: identity.appKey,
      platform: 'wechat',
      miniAppId: identity.miniAppId,
      openId: identity.openId,
      unionId: identity.unionId,
    }
  },
  async exchangePhoneCode(input) {
    return await exchangeMiniProgramPhoneCode(input.code, input.appKey, 'wechat')
  },
}

const douyinAuthProvider: MiniPlatformAuthProvider = {
  platform: 'douyin',
  async exchangeCode(input) {
    return await exchangeMiniPlatformCodeByHttp({
      appKey: input.appKey,
      code: input.code,
      platform: 'douyin',
      endpoint: 'https://developer.toutiao.com/api/apps/jscode2session',
      appIdKey: 'appid',
      appSecretKey: 'secret',
    })
  },
}

const xiaohongshuAuthProvider: MiniPlatformAuthProvider = {
  platform: 'xiaohongshu',
  async exchangeCode(input) {
    return await exchangeMiniPlatformCodeByHttp({
      appKey: input.appKey,
      code: input.code,
      platform: 'xiaohongshu',
      endpoint: 'https://miniapp.xiaohongshu.com/api/rmp/session',
      appIdKey: 'app_id',
      appSecretKey: 'app_secret',
    })
  },
}

const wechatPaymentProvider: MiniPlatformPaymentProvider = {
  platform: 'wechat',
  async createPayment(input) {
    return await createOrderPayment({
      channel: 'wechat',
      appKey: input.appKey,
      platform: 'wechat',
      orderNumber: input.orderNumber,
      description: input.description,
      amount: input.amount,
      openId: input.openId,
      attach: input.attach,
    })
  },
}

async function createGenericPlatformPayment(platform: MiniPlatformKind, input: {
  appKey?: string
  orderNumber: string
  description: string
  amount: number
  openId: string
  attach?: string
}): Promise<PaymentResult> {
  const platformConfig = await resolveMiniAppPlatformConfig(platform, input.appKey)
  if (!platformConfig.paymentConfig.enabled) {
    throw new Error(`Platform payment is disabled for ${platform}`)
  }
  const extConfig = platformConfig.paymentConfig.extConfig as Record<string, unknown> | undefined
  const clientPayParams = extConfig?.clientPayParams as Record<string, unknown> | undefined
  if (!clientPayParams || typeof clientPayParams !== 'object') {
    throw new Error(`Missing clientPayParams for ${platform}`)
  }
  return {
    status: 'pending',
    provider: String(platformConfig.paymentConfig.channel || platform),
    payParams: clientPayParams as Record<string, unknown>,
    raw: {
      platform,
      appKey: platformConfig.appKey,
      orderNumber: input.orderNumber,
      description: input.description,
      amount: input.amount,
      openId: input.openId,
      attach: input.attach,
    },
  }
}

const douyinPaymentProvider: MiniPlatformPaymentProvider = {
  platform: 'douyin',
  async createPayment(input) {
    return await createGenericPlatformPayment('douyin', input)
  },
}

const xiaohongshuPaymentProvider: MiniPlatformPaymentProvider = {
  platform: 'xiaohongshu',
  async createPayment(input) {
    return await createGenericPlatformPayment('xiaohongshu', input)
  },
}

const privacyProvider = (platform: MiniPlatformKind): MiniPlatformPrivacyProvider => ({
  platform,
  async acceptConsent() {
    return { accepted: true }
  },
})

const authProviders: Record<MiniPlatformKind, MiniPlatformAuthProvider> = {
  wechat: wechatAuthProvider,
  douyin: douyinAuthProvider,
  xiaohongshu: xiaohongshuAuthProvider,
}

const paymentProviders: Record<MiniPlatformKind, MiniPlatformPaymentProvider> = {
  wechat: wechatPaymentProvider,
  douyin: douyinPaymentProvider,
  xiaohongshu: xiaohongshuPaymentProvider,
}

const privacyProviders: Record<MiniPlatformKind, MiniPlatformPrivacyProvider> = {
  wechat: privacyProvider('wechat'),
  douyin: privacyProvider('douyin'),
  xiaohongshu: privacyProvider('xiaohongshu'),
}

export function getMiniPlatformAuthProvider(platform: MiniPlatformKind): MiniPlatformAuthProvider {
  return authProviders[platform]
}

export function getMiniPlatformPaymentProvider(platform: MiniPlatformKind): MiniPlatformPaymentProvider {
  return paymentProviders[platform]
}

export function getMiniPlatformPrivacyProvider(platform: MiniPlatformKind): MiniPlatformPrivacyProvider {
  return privacyProviders[platform]
}
