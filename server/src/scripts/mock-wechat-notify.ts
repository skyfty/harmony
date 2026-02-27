import { createCipheriv, createSign, randomBytes } from 'node:crypto'
import { appConfig } from '@/config/env'

function encryptNotifyResource(plainText: string) {
  const key = Buffer.from(appConfig.wechatPay.apiV3Key, 'utf8')
  const nonce = randomBytes(12).toString('hex').slice(0, 12)
  const aad = Buffer.from('harmony-mock', 'utf8')
  const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'))
  cipher.setAAD(aad)
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plainText, 'utf8')), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    algorithm: 'AEAD_AES_256_GCM',
    nonce,
    associated_data: aad.toString('utf8'),
    ciphertext: Buffer.concat([encrypted, authTag]).toString('base64'),
  }
}

function signBody(body: string) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomBytes(16).toString('hex')
  const signatureSource = `${timestamp}\n${nonce}\n${body}\n`
  const privateKey = appConfig.wechatPay.mockPlatformPrivateKey
  if (!privateKey) {
    return {
      headers: {
        'Wechatpay-Timestamp': timestamp,
        'Wechatpay-Nonce': nonce,
        'Wechatpay-Signature': 'mock-signature',
      },
    }
  }
  const signer = createSign('RSA-SHA256')
  signer.update(signatureSource)
  signer.end()
  const signature = signer.sign(privateKey, 'base64')
  return {
    headers: {
      'Wechatpay-Timestamp': timestamp,
      'Wechatpay-Nonce': nonce,
      'Wechatpay-Signature': signature,
    },
  }
}

async function main() {
  if (!appConfig.wechatPay.enabled) {
    throw new Error('WECHAT_PAY_ENABLED=false, cannot send mock notify')
  }
  if (!appConfig.wechatPay.apiV3Key || appConfig.wechatPay.apiV3Key.length !== 32) {
    throw new Error('WECHAT_PAY_API_V3_KEY must be 32 bytes for mock notify encryption')
  }

  const orderNumber = process.argv[2]
  if (!orderNumber) {
    throw new Error('Usage: pnpm run mock:wechat-notify -- <orderNumber> [success|fail]')
  }
  const mode = process.argv[3] === 'fail' ? 'fail' : 'success'

  const transaction = {
    appid: appConfig.wechatPay.appId,
    mchid: appConfig.wechatPay.mchId,
    out_trade_no: orderNumber,
    transaction_id: `MOCK_TXN_${Date.now()}`,
    trade_type: 'JSAPI',
    trade_state: mode === 'success' ? 'SUCCESS' : 'PAYERROR',
    trade_state_desc: mode === 'success' ? '支付成功' : '支付失败',
    success_time: new Date().toISOString(),
    amount: {
      total: 1,
      payer_total: 1,
      currency: 'CNY',
      payer_currency: 'CNY',
    },
  }

  const resource = encryptNotifyResource(JSON.stringify(transaction))
  const payload = {
    id: `mock-notify-${Date.now()}`,
    create_time: new Date().toISOString(),
    event_type: 'TRANSACTION.SUCCESS',
    resource_type: 'encrypt-resource',
    resource,
    summary: 'mock notify',
  }
  const body = JSON.stringify(payload)
  const { headers } = signBody(body)

  const response = await fetch(`http://127.0.0.1:${appConfig.port}/wechat/pay/notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
  })
  const text = await response.text()
  console.log(`[mock-wechat-notify] status=${response.status} body=${text}`)
}

main().catch((error) => {
  console.error('[mock-wechat-notify] failed:', error)
  process.exit(1)
})
