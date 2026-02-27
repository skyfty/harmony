import { createDecipheriv, createSign, createVerify, randomBytes } from 'node:crypto'
import { appConfig } from '@/config/env'

type PaymentChannel = 'wechat'

export type PaymentStatus = 'success' | 'failed' | 'pending'

export interface WechatPrepayResult {
  appId: string
  timeStamp: string
  nonceStr: string
  package: string
  signType: 'RSA'
  paySign: string
  prepayId: string
}

export interface CreatePaymentOptions {
  channel: PaymentChannel
  miniAppId?: string
  orderNumber: string
  description: string
  amount: number
  openId: string
  attach?: string
}

export interface PaymentResult {
  status: PaymentStatus
  provider: string
  transactionId?: string
  prepayId?: string
  message?: string
  raw?: Record<string, unknown>
  payParams?: WechatPrepayResult
}

type WechatNotifyResource = {
  algorithm: string
  ciphertext: string
  nonce: string
  associated_data?: string
}

type WechatNotifyBody = {
  id: string
  create_time: string
  event_type: string
  resource_type: string
  resource: WechatNotifyResource
  summary: string
}

type WechatTransaction = {
  appid: string
  mchid: string
  out_trade_no: string
  transaction_id: string
  trade_type: string
  trade_state: string
  trade_state_desc?: string
  success_time?: string
  attach?: string
  amount?: {
    total?: number
    payer_total?: number
    currency?: string
    payer_currency?: string
  }
  payer?: {
    openid?: string
  }
}

function resolveWechatPayConfig(miniAppId?: string) {
  const requestedMiniAppId = (miniAppId ?? '').trim() || appConfig.wechatPay.defaultMiniAppId
  if (!requestedMiniAppId) {
    throw new Error('miniAppId is required for WeChat pay')
  }
  const config = appConfig.wechatPay.apps[requestedMiniAppId]
  if (!config) {
    throw new Error('WeChat pay config not found for miniAppId')
  }
  return {
    miniAppId: requestedMiniAppId,
    config,
  }
}

function getWechatConfig(miniAppId?: string) {
  const { config } = resolveWechatPayConfig(miniAppId)
  if (!config.enabled) {
    throw new Error('WeChat pay is disabled')
  }
  if (!config.appId || !config.mchId || !config.serialNo || !config.privateKey || !config.apiV3Key || !config.notifyUrl) {
    throw new Error('Missing WeChat pay configuration')
  }
  return config
}

function listWechatPayConfigs() {
  const result: Array<{ miniAppId: string; config: ReturnType<typeof getWechatConfig> }> = []
  for (const [miniAppId, config] of Object.entries(appConfig.wechatPay.apps)) {
    if (!config?.enabled) {
      continue
    }
    try {
      result.push({
        miniAppId,
        config: getWechatConfig(miniAppId),
      })
    } catch {
      continue
    }
  }
  return result
}

function toMinorCurrency(amountYuan: number): number {
  return Math.max(0, Math.round(amountYuan * 100))
}

function sha256RsaSign(privateKey: string, message: string): string {
  const signer = createSign('RSA-SHA256')
  signer.update(message)
  signer.end()
  return signer.sign(privateKey, 'base64')
}

function buildAuthorization(method: string, requestPath: string, body: string, miniAppId?: string) {
  const { mchId, serialNo, privateKey } = getWechatConfig(miniAppId)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonceStr = randomBytes(16).toString('hex')
  const message = `${method}\n${requestPath}\n${timestamp}\n${nonceStr}\n${body}\n`
  const signature = sha256RsaSign(privateKey, message)
  return {
    nonceStr,
    timestamp,
    authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonceStr}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`,
  }
}

async function requestWechat<T>(requestPath: string, payload: Record<string, unknown>, miniAppId?: string): Promise<T> {
  const config = getWechatConfig(miniAppId)
  const body = JSON.stringify(payload)
  const { authorization } = buildAuthorization('POST', requestPath, body, miniAppId)
  const response = await fetch(`${config.baseUrl}${requestPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: authorization,
      'User-Agent': 'HarmonyServer/1.0',
    },
    body,
  })
  const text = await response.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }
  if (!response.ok) {
    const message = typeof parsed === 'object' && parsed && 'message' in parsed ? String((parsed as any).message) : 'Wechat pay request failed'
    throw new Error(message)
  }
  return parsed as T
}

function buildWechatClientPayParams(prepayId: string, miniAppId?: string): WechatPrepayResult {
  const config = getWechatConfig(miniAppId)
  const timeStamp = String(Math.floor(Date.now() / 1000))
  const nonceStr = randomBytes(16).toString('hex')
  const packageValue = `prepay_id=${prepayId}`
  const message = `${config.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`
  const paySign = sha256RsaSign(config.privateKey, message)
  return {
    appId: config.appId,
    timeStamp,
    nonceStr,
    package: packageValue,
    signType: 'RSA',
    paySign,
    prepayId,
  }
}

export async function createOrderPayment(options: CreatePaymentOptions): Promise<PaymentResult> {
  const { channel, miniAppId, orderNumber, description, amount, openId, attach } = options
  if (channel !== 'wechat') {
    return {
      status: 'failed',
      provider: channel,
      message: 'Unsupported payment channel',
    }
  }
  const config = getWechatConfig(miniAppId)
  const payload: Record<string, unknown> = {
    appid: config.appId,
    mchid: config.mchId,
    description,
    out_trade_no: orderNumber,
    notify_url: config.notifyUrl,
    amount: {
      total: toMinorCurrency(amount),
      currency: 'CNY',
    },
    payer: {
      openid: openId,
    },
  }
  if (attach) {
    payload.attach = attach
  }
  const result = await requestWechat<{ prepay_id: string }>('/v3/pay/transactions/jsapi', payload, miniAppId)
  if (!result?.prepay_id) {
    throw new Error('Failed to create prepay order')
  }
  const payParams = buildWechatClientPayParams(result.prepay_id, miniAppId)
  return {
    status: 'pending',
    provider: 'wechat',
    prepayId: result.prepay_id,
    payParams,
    raw: {
      prepayId: result.prepay_id,
    },
  }
}

export function verifyWechatCallbackSignature(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  miniAppId?: string,
): boolean {
  const signature = typeof headers['wechatpay-signature'] === 'string' ? headers['wechatpay-signature'] : ''
  const timestamp = typeof headers['wechatpay-timestamp'] === 'string' ? headers['wechatpay-timestamp'] : ''
  const nonce = typeof headers['wechatpay-nonce'] === 'string' ? headers['wechatpay-nonce'] : ''
  if (!signature || !timestamp || !nonce) {
    return false
  }
  const message = `${timestamp}\n${nonce}\n${rawBody}\n`
  const candidates = miniAppId
    ? [{ miniAppId, config: getWechatConfig(miniAppId) }]
    : listWechatPayConfigs()
  for (const { config } of candidates) {
    if (appConfig.isDevelopment && config.callbackSkipVerifyInDev) {
      return true
    }
    if (!config.platformPublicKey) {
      continue
    }
    const verifier = createVerify('RSA-SHA256')
    verifier.update(message)
    verifier.end()
    if (verifier.verify(config.platformPublicKey, signature, 'base64')) {
      return true
    }
  }
  return false
}

export function decryptWechatNotifyResource(resource: WechatNotifyResource, miniAppId?: string): WechatTransaction {
  if (resource.algorithm !== 'AEAD_AES_256_GCM') {
    throw new Error('Unsupported notify encryption algorithm')
  }
  const candidates = miniAppId
    ? [{ miniAppId, config: getWechatConfig(miniAppId) }]
    : listWechatPayConfigs()
  let lastError: unknown = null
  for (const { config } of candidates) {
    try {
      const ciphertext = Buffer.from(resource.ciphertext, 'base64')
      const nonce = Buffer.from(resource.nonce, 'utf8')
      const aad = Buffer.from(resource.associated_data ?? '', 'utf8')
      const authTag = ciphertext.subarray(ciphertext.length - 16)
      const data = ciphertext.subarray(0, ciphertext.length - 16)
      const decipher = createDecipheriv('aes-256-gcm', Buffer.from(config.apiV3Key, 'utf8'), nonce)
      if (aad.length) {
        decipher.setAAD(aad)
      }
      decipher.setAuthTag(authTag)
      const decoded = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
      return JSON.parse(decoded) as WechatTransaction
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to decrypt wechat notify resource')
}

export function parseWechatNotifyBody(body: unknown): WechatNotifyBody {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid notify body')
  }
  return body as WechatNotifyBody
}
