import { MiniAppModel } from '@/models/MiniApp'
import { appConfig } from '@/config/env'

export type ResolvedMiniApp = {
  miniAppId: string
  name: string
  appSecret: string
  enabled: boolean
  isDefault: boolean
  wechatPay: {
    enabled: boolean
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
}

function mapMiniApp(row: any): ResolvedMiniApp {
  return {
    miniAppId: String(row.miniAppId ?? '').trim(),
    name: String(row.name ?? '').trim(),
    appSecret: String(row.appSecret ?? ''),
    enabled: row.enabled !== false,
    isDefault: row.isDefault === true,
    wechatPay: {
      enabled: row.wechatPay?.enabled === true,
      mchId: String(row.wechatPay?.mchId ?? '').trim(),
      serialNo: String(row.wechatPay?.serialNo ?? '').trim(),
      privateKey: String(row.wechatPay?.privateKey ?? '').replace(/\\n/g, '\n'),
      apiV3Key: String(row.wechatPay?.apiV3Key ?? '').trim(),
      notifyUrl: String(row.wechatPay?.notifyUrl ?? 'https://v.touchmagic.cn/wechat/pay/notify').trim(),
      baseUrl: String(row.wechatPay?.baseUrl ?? 'https://api.mch.weixin.qq.com').trim(),
      platformPublicKey: String(row.wechatPay?.platformPublicKey ?? '').replace(/\\n/g, '\n'),
      callbackSkipVerifyInDev: row.wechatPay?.callbackSkipVerifyInDev === true,
      mockPlatformPrivateKey: String(row.wechatPay?.mockPlatformPrivateKey ?? '').replace(/\\n/g, '\n'),
    },
  }
}

export async function resolveMiniAppConfig(miniAppId?: string): Promise<ResolvedMiniApp> {
  const requestedMiniAppId = (miniAppId ?? '').trim()

  if (requestedMiniAppId) {
    const byId = await MiniAppModel.findOne({ miniAppId: requestedMiniAppId, enabled: true }).lean().exec()
    if (!byId) {
      throw new Error('MiniApp not found or disabled')
    }
    return mapMiniApp(byId)
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

export async function listEnabledMiniApps(): Promise<ResolvedMiniApp[]> {
  const rows = await MiniAppModel.find({ enabled: true }).sort({ createdAt: 1 }).lean().exec()
  return rows.map(mapMiniApp)
}