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
  method?: 'GET' | 'POST'
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

  const requestPayload = {
    code: input.code,
    [input.appIdKey]: platformConfig.appId,
    [input.appSecretKey]: platformConfig.appSecret,
  }
  const url = new URL(input.endpoint)
  if (input.method !== 'POST') {
    Object.entries(requestPayload).forEach(([key, value]) => url.searchParams.set(key, value))
  }
  const response = await fetch(url.toString(), input.method === 'POST' ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestPayload),
  } : { method: 'GET' })
  const payload = await response.json().catch(() => null)
  const businessCode = Number(payload?.err_no ?? payload?.errno ?? payload?.code ?? 0)
  if (!response.ok || businessCode !== 0) {
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

async function exchangePlatformPhoneCode(input: {
  appKey?: string
  code: string
  platform: 'douyin' | 'xiaohongshu'
  defaultEndpoint?: string
}): Promise<{ phoneNumber: string; purePhoneNumber: string; countryCode?: string }> {
  const platformConfig = await resolveMiniAppPlatformConfig(input.platform, input.appKey)
  const configuredEndpoint = String(platformConfig.loginConfig.phoneEndpoint ?? '').trim()
  const endpoint = configuredEndpoint || input.defaultEndpoint
  if (!endpoint) {
    throw new Error(`Phone endpoint is not configured for ${input.platform}`)
  }
  if (!platformConfig.loginConfig.enabled || !platformConfig.appId || !platformConfig.appSecret) {
    throw new Error(`Phone capability is not configured for ${input.platform}`)
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appid: platformConfig.appId,
      app_id: platformConfig.appId,
      secret: platformConfig.appSecret,
      app_secret: platformConfig.appSecret,
      code: input.code,
    }),
  })
  const payload = await response.json().catch(() => null)
  const businessCode = Number(payload?.err_no ?? payload?.errno ?? payload?.code ?? 0)
  if (!response.ok || businessCode !== 0) {
    throw new Error(String(payload?.err_tips ?? payload?.errmsg ?? payload?.message ?? `Phone exchange failed for ${input.platform}`))
  }
  const data = payload?.data ?? payload
  const phoneNumber = String(data?.phoneNumber ?? data?.phone_number ?? '').trim()
  const purePhoneNumber = String(data?.purePhoneNumber ?? data?.pure_phone_number ?? phoneNumber).trim()
  if (!phoneNumber && !purePhoneNumber) {
    throw new Error(`Phone response is missing a phone number for ${input.platform}`)
  }
  return {
    phoneNumber: phoneNumber || purePhoneNumber,
    purePhoneNumber: purePhoneNumber || phoneNumber,
    countryCode: String(data?.countryCode ?? data?.country_code ?? '').trim() || undefined,
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
      endpoint: 'https://developer.toutiao.com/api/apps/v2/jscode2session',
      appIdKey: 'appid',
      appSecretKey: 'secret',
      method: 'POST',
    })
  },
  async exchangePhoneCode(input) {
    return await exchangePlatformPhoneCode({
      ...input,
      platform: 'douyin',
      defaultEndpoint: 'https://developer.toutiao.com/api/apps/v2/phonenumber',
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
  async exchangePhoneCode(input) {
    return await exchangePlatformPhoneCode({ ...input, platform: 'xiaohongshu' })
  },
}

const wechatPaymentProvider: MiniPlatformPaymentProvider = {
  platform: 'wechat',
  async createPayment(input) {
    const platformConfig = await resolveMiniAppPlatformConfig('wechat', input.appKey)
    if (!platformConfig.paymentConfig.enabled) {
      throw createPaymentDisabledError('wechat')
    }
    const result = await createOrderPayment({
      channel: 'wechat',
      appKey: input.appKey,
      platform: 'wechat',
      orderNumber: input.orderNumber,
      description: input.description,
      amount: input.amount,
      openId: input.openId,
      attach: input.attach,
    })
    return {
      ...result,
      payParams: result.payParams ? {
        kind: 'wechat',
        provider: 'wxpay',
        params: result.payParams,
      } : undefined,
    }
  },
}

function createPaymentDisabledError(platform: MiniPlatformKind): Error {
  return Object.assign(new Error(`当前平台支付未开放：${platform}`), {
    status: 400,
    code: 'MINI_PAYMENT_DISABLED',
  })
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
    throw createPaymentDisabledError(platform)
  }
  const extConfig = platformConfig.paymentConfig.extConfig as Record<string, unknown> | undefined
  const clientPayParams = extConfig?.clientPayParams as Record<string, unknown> | undefined
  if (!clientPayParams || typeof clientPayParams !== 'object') {
    throw new Error(`Missing clientPayParams for ${platform}`)
  }
  const payParams = platform === 'douyin'
    ? {
        kind: 'douyin-guarantee',
        orderInfo: {
          order_id: String(clientPayParams.order_id ?? ''),
          order_token: String(clientPayParams.order_token ?? ''),
        },
        service: 5,
      }
    : {
        kind: 'xiaohongshu-order',
        orderInfo: clientPayParams.orderInfo && typeof clientPayParams.orderInfo === 'object'
          ? clientPayParams.orderInfo as Record<string, unknown>
          : clientPayParams,
      }
  if (platform === 'douyin' && (!payParams.orderInfo.order_id || !payParams.orderInfo.order_token)) {
    throw new Error('Douyin payment order_id or order_token is missing')
  }
  return {
    status: 'pending',
    provider: String(platformConfig.paymentConfig.channel || platform),
    payParams,
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
