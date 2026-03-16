import { appConfig } from '@/config/env'
import { resolveMiniAppConfig } from '@/services/miniAppService'

interface WechatCode2SessionSuccess {
  openid: string
  unionid?: string
  session_key?: string
}

interface WechatCode2SessionError {
  errcode: number
  errmsg?: string
}

type WechatCode2SessionResponse = WechatCode2SessionSuccess | WechatCode2SessionError

export interface WechatMiniIdentity {
  miniAppId: string
  openId: string
  unionId?: string
  sessionKey?: string
}

async function getWechatMiniConfig(miniAppId?: string) {
  const match = await resolveMiniAppConfig(miniAppId)
  return {
    miniAppId: match.miniAppId,
    appId: match.miniAppId,
    appSecret: match.appSecret,
    baseUrl: appConfig.miniAuth.wechatApiBaseUrl,
  }
}

function normalizeWechatError(response: WechatCode2SessionError): string {
  const code = Number(response.errcode || 0)
  if (!code) {
    return 'Invalid wechat code2session response'
  }
  if (code === 40029) {
    return 'Invalid wechat login code'
  }
  if (code === 45011) {
    return 'Wechat login rate limited'
  }
  return response.errmsg
    ? `Wechat login failed [${code}]: ${response.errmsg}`
    : `Wechat login failed [${code}]`
}

export async function exchangeMiniProgramCode(code: string, miniAppId?: string): Promise<WechatMiniIdentity> {
  const safeCode = code.trim()
  if (!safeCode) {
    throw new Error('code is required')
  }

  const config = await getWechatMiniConfig(miniAppId)
  const params = new URLSearchParams({
    appid: config.appId,
    secret: config.appSecret,
    js_code: safeCode,
    grant_type: 'authorization_code',
  })
  const url = `${config.baseUrl}/sns/jscode2session?${params.toString()}`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'HarmonyServer/1.0',
    },
  })

  const text = await response.text()
  let parsed: WechatCode2SessionResponse | null = null

  if (text) {
    try {
      parsed = JSON.parse(text) as WechatCode2SessionResponse
    } catch {
      throw new Error('Wechat login response parse failed')
    }
  }

  if (!response.ok) {
    console.error('[mini-wechat-login] code2session http error', {
      status: response.status,
      statusText: response.statusText,
      miniAppId: config.miniAppId,
      baseUrl: config.baseUrl,
      responseText: text,
    })
    throw new Error('Wechat login request failed')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Wechat login response invalid')
  }

  if ('errcode' in parsed && parsed.errcode) {
    console.error('[mini-wechat-login] code2session business error', {
      miniAppId: config.miniAppId,
      errcode: parsed.errcode,
      errmsg: parsed.errmsg,
      baseUrl: config.baseUrl,
    })
    throw new Error(normalizeWechatError(parsed))
  }

  if (!('openid' in parsed) || !parsed.openid) {
    throw new Error('Wechat login response missing openid')
  }

  return {
    miniAppId: config.miniAppId,
    openId: parsed.openid,
    unionId: parsed.unionid,
    sessionKey: parsed.session_key,
  }
}
