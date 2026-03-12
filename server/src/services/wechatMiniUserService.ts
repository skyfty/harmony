import { appConfig } from '@/config/env'
import { resolveMiniAppConfig } from '@/services/miniAppService'

type StableAccessTokenSuccess = {
  access_token: string
  expires_in: number
}

type StableAccessTokenError = {
  errcode?: number
  errmsg?: string
}

type StableAccessTokenResponse = StableAccessTokenSuccess & StableAccessTokenError

type WechatPhoneInfo = {
  phoneNumber?: string
  purePhoneNumber?: string
  countryCode?: string
}

type WechatPhoneResponse = {
  phone_info?: WechatPhoneInfo
  errcode?: number
  errmsg?: string
}

export interface BoundWechatPhone {
  phoneNumber: string
  purePhoneNumber: string
  countryCode?: string
}

type AccessTokenCacheEntry = {
  value: string
  expiresAt: number
}

const accessTokenCache = new Map<string, AccessTokenCacheEntry>()

function normalizeWechatError(response: { errcode?: number; errmsg?: string }, fallback: string): string {
  const errcode = Number(response.errcode ?? 0)
  if (!errcode) {
    return fallback
  }
  return response.errmsg ? `${fallback}: ${response.errmsg}` : fallback
}

async function getMiniAppWechatConfig(miniAppId?: string) {
  const match = await resolveMiniAppConfig(miniAppId)
  return {
    miniAppId: match.miniAppId,
    appId: match.miniAppId,
    appSecret: match.appSecret,
    baseUrl: appConfig.miniAuth.wechatApiBaseUrl,
  }
}

async function requestStableAccessToken(miniAppId?: string, forceRefresh = false): Promise<string> {
  const config = await getMiniAppWechatConfig(miniAppId)
  const cacheKey = config.miniAppId
  const cached = accessTokenCache.get(cacheKey)
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const response = await fetch(`${config.baseUrl}/cgi-bin/stable_token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'HarmonyServer/1.0',
    },
    body: JSON.stringify({
      grant_type: 'client_credential',
      appid: config.appId,
      secret: config.appSecret,
      force_refresh: forceRefresh,
    }),
  })

  const parsed = (await response.json().catch(() => null)) as StableAccessTokenResponse | null
  if (!response.ok || !parsed || !parsed.access_token) {
    throw new Error(normalizeWechatError(parsed ?? {}, 'Failed to fetch WeChat access token'))
  }
  if (parsed.errcode) {
    throw new Error(normalizeWechatError(parsed, 'Failed to fetch WeChat access token'))
  }

  const ttlMs = Math.max(60, Number(parsed.expires_in || 7200) - 300) * 1000
  accessTokenCache.set(cacheKey, {
    value: parsed.access_token,
    expiresAt: Date.now() + ttlMs,
  })
  return parsed.access_token
}

async function requestPhoneByCode(code: string, miniAppId?: string, forceRefreshToken = false): Promise<BoundWechatPhone> {
  const accessToken = await requestStableAccessToken(miniAppId, forceRefreshToken)
  const config = await getMiniAppWechatConfig(miniAppId)
  const response = await fetch(`${config.baseUrl}/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'HarmonyServer/1.0',
    },
    body: JSON.stringify({ code }),
  })

  const parsed = (await response.json().catch(() => null)) as WechatPhoneResponse | null
  if (!response.ok || !parsed) {
    throw new Error('Failed to fetch WeChat phone number')
  }
  if (parsed.errcode) {
    throw new Error(normalizeWechatError(parsed, 'Failed to fetch WeChat phone number'))
  }

  const phoneInfo = parsed.phone_info
  const purePhoneNumber = String(phoneInfo?.purePhoneNumber ?? '').trim()
  const phoneNumber = String(phoneInfo?.phoneNumber ?? purePhoneNumber).trim()
  if (!phoneNumber) {
    throw new Error('WeChat phone response missing phone number')
  }

  return {
    phoneNumber,
    purePhoneNumber: purePhoneNumber || phoneNumber,
    countryCode: String(phoneInfo?.countryCode ?? '').trim() || undefined,
  }
}

export async function exchangeMiniProgramPhoneCode(code: string, miniAppId?: string): Promise<BoundWechatPhone> {
  const safeCode = code.trim()
  if (!safeCode) {
    throw new Error('code is required')
  }

  try {
    return await requestPhoneByCode(safeCode, miniAppId, false)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch WeChat phone number'
    const shouldForceRefresh = /access token|credential/i.test(message)
    if (!shouldForceRefresh) {
      throw error
    }
    return await requestPhoneByCode(safeCode, miniAppId, true)
  }
}