import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config()

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

type WechatMiniAppConfig = {
  appId: string
  appSecret: string
}

type WechatPayAppConfig = {
  enabled: boolean
  appId: string
  mchId: string
  serialNo: string
  privateKey: string
  apiV3Key: string
  notifyUrl: string
  baseUrl: string
  platformPublicKey: string
  callbackSkipVerifyInDev: boolean
  mockPlatformPrivateKey: string
}

function safeParseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function normalizeWechatMiniAppsMap(
  fallbackAppId: string,
  fallbackAppSecret: string,
  rawMap: Record<string, Partial<WechatMiniAppConfig>>,
): Record<string, WechatMiniAppConfig> {
  const map: Record<string, WechatMiniAppConfig> = {}
  for (const [miniAppId, config] of Object.entries(rawMap)) {
    if (!miniAppId.trim()) {
      continue
    }
    const appId = String(config.appId ?? '').trim()
    const appSecret = String(config.appSecret ?? '').trim()
    if (!appId || !appSecret) {
      continue
    }
    map[miniAppId.trim()] = {
      appId,
      appSecret,
    }
  }
  if (fallbackAppId && fallbackAppSecret) {
    const key = fallbackAppId.trim()
    if (!map[key]) {
      map[key] = {
        appId: fallbackAppId,
        appSecret: fallbackAppSecret,
      }
    }
  }
  return map
}

function normalizeWechatPayAppsMap(
  fallbackConfig: WechatPayAppConfig,
  rawMap: Record<string, Partial<WechatPayAppConfig>>,
): Record<string, WechatPayAppConfig> {
  const map: Record<string, WechatPayAppConfig> = {}
  for (const [miniAppId, config] of Object.entries(rawMap)) {
    if (!miniAppId.trim()) {
      continue
    }
    const appId = String(config.appId ?? '').trim()
    if (!appId) {
      continue
    }
    map[miniAppId.trim()] = {
      enabled: Boolean(config.enabled),
      appId,
      mchId: String(config.mchId ?? '').trim(),
      serialNo: String(config.serialNo ?? '').trim(),
      privateKey: String(config.privateKey ?? '').replace(/\\n/g, '\n'),
      apiV3Key: String(config.apiV3Key ?? '').trim(),
      notifyUrl: String(config.notifyUrl ?? '').trim(),
      baseUrl: String(config.baseUrl ?? 'https://api.mch.weixin.qq.com').trim(),
      platformPublicKey: String(config.platformPublicKey ?? '').replace(/\\n/g, '\n'),
      callbackSkipVerifyInDev: Boolean(config.callbackSkipVerifyInDev),
      mockPlatformPrivateKey: String(config.mockPlatformPrivateKey ?? '').replace(/\\n/g, '\n'),
    }
  }
  if (fallbackConfig.appId) {
    const key = fallbackConfig.appId.trim()
    if (!map[key]) {
      map[key] = fallbackConfig
    }
  }
  return map
}

const fallbackWechatMiniAppId = process.env.WECHAT_MINI_APP_ID ?? ''
const fallbackWechatMiniAppSecret = process.env.WECHAT_MINI_APP_SECRET ?? ''
const wechatMiniAppsJson = safeParseJson<Record<string, Partial<WechatMiniAppConfig>>>(
  process.env.WECHAT_MINI_APPS_JSON,
  {},
)
const wechatMiniApps = normalizeWechatMiniAppsMap(
  fallbackWechatMiniAppId,
  fallbackWechatMiniAppSecret,
  wechatMiniAppsJson,
)

const fallbackWechatPayConfig: WechatPayAppConfig = {
  enabled: (process.env.WECHAT_PAY_ENABLED ?? 'false') === 'true',
  appId: process.env.WECHAT_PAY_APP_ID ?? '',
  mchId: process.env.WECHAT_PAY_MCH_ID ?? '',
  serialNo: process.env.WECHAT_PAY_SERIAL_NO ?? '',
  privateKey: (process.env.WECHAT_PAY_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  apiV3Key: process.env.WECHAT_PAY_API_V3_KEY ?? '',
  notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL ?? '',
  baseUrl: process.env.WECHAT_PAY_BASE_URL ?? 'https://api.mch.weixin.qq.com',
  platformPublicKey: (process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY ?? '').replace(/\\n/g, '\n'),
  callbackSkipVerifyInDev: (process.env.WECHAT_PAY_CALLBACK_SKIP_VERIFY_IN_DEV ?? 'false') === 'true',
  mockPlatformPrivateKey: (process.env.WECHAT_PAY_MOCK_PLATFORM_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
}
const wechatPayAppsJson = safeParseJson<Record<string, Partial<WechatPayAppConfig>>>(process.env.WECHAT_PAY_APPS_JSON, {})
const wechatPayApps = normalizeWechatPayAppsMap(fallbackWechatPayConfig, wechatPayAppsJson)

export const appConfig = {
  isDevelopment: process.env.NODE_ENV !== 'production',
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/harmony',
  jwtSecret: process.env.JWT_SECRET ?? 'change-me',
  business: {
    contactPhone: process.env.BUSINESS_CONTACT_PHONE ?? '400-000-0000',
  },
  adminAuth: {
    jwtSecret: process.env.ADMIN_JWT_SECRET ?? process.env.JWT_SECRET ?? 'change-me-admin',
    issuer: process.env.ADMIN_JWT_ISSUER ?? 'harmony-admin',
    audience: process.env.ADMIN_JWT_AUDIENCE ?? 'harmony-admin-api',
    expiresIn: process.env.ADMIN_JWT_EXPIRES_IN ?? '12h',
    seed: {
      username: process.env.ADMIN_SEED_USERNAME ?? 'admin',
      password: process.env.ADMIN_SEED_PASSWORD ?? 'admin123',
      displayName: process.env.ADMIN_SEED_DISPLAY_NAME ?? '系统管理员',
    },
  },
  miniAuth: {
    jwtSecret: process.env.MINI_JWT_SECRET ?? 'change-me-mini',
    issuer: process.env.MINI_JWT_ISSUER ?? 'harmony-mini',
    audience: process.env.MINI_JWT_AUDIENCE ?? 'harmony-mini-api',
    expiresIn: process.env.MINI_JWT_EXPIRES_IN ?? '12h',
    defaultDisplayName: process.env.MINI_DEFAULT_DISPLAY_NAME ?? '微信用户',
    allowTestBypassInNonProd:
      process.env.NODE_ENV !== 'production' && (process.env.MINI_AUTH_ALLOW_TEST_BYPASS_IN_NON_PROD ?? 'true') === 'true',
    defaultMiniAppId: process.env.WECHAT_MINI_DEFAULT_APP_ID ?? fallbackWechatMiniAppId,
    wechatMiniAppId: fallbackWechatMiniAppId,
    wechatMiniAppSecret: fallbackWechatMiniAppSecret,
    wechatApiBaseUrl: process.env.WECHAT_API_BASE_URL ?? 'https://api.weixin.qq.com',
    wechatMiniApps,
  },
  assetStoragePath: path.resolve(process.cwd(), process.env.ASSET_STORAGE_PATH ?? './uploads'),
  assetPublicUrl: process.env.ASSET_PUBLIC_URL ?? 'http://localhost:4000/uploads',
  editorPublicUrl: process.env.EDITOR_PUBLIC_URL ?? 'http://localhost:5173',
  editorUser: {
    username: process.env.EDITOR_USER_USERNAME ?? 'editor',
    password: process.env.EDITOR_USER_PASSWORD ?? 'editor123',
    displayName: process.env.EDITOR_USER_DISPLAY_NAME ?? 'Editor 用户',
  },
  miniProgramTestUser: {
    username: process.env.MINIPROGRAM_TEST_USER_USERNAME ?? 'test',
    password: process.env.MINIPROGRAM_TEST_USER_PASSWORD ?? 'test1234',
    displayName: process.env.MINIPROGRAM_TEST_USER_DISPLAY_NAME ?? 'Test Account',
  },
  multiuserPort: Number(process.env.MULTIUSER_PORT ?? 7645),
  wechatPay: {
    ...fallbackWechatPayConfig,
    defaultMiniAppId: process.env.WECHAT_PAY_DEFAULT_APP_ID ?? fallbackWechatPayConfig.appId,
    apps: wechatPayApps,
  },
  openAi: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    baseUrl: process.env.OPENAI_BASE_URL,
    organization: process.env.OPENAI_ORG,
    project: process.env.OPENAI_PROJECT,
  },
  rootDir,
}
