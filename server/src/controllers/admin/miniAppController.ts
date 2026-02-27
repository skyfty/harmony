import type { Context } from 'koa'
import { MiniAppModel } from '@/models/MiniApp'

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function mapMiniApp(row: any) {
  return {
    id: row._id.toString(),
    miniAppId: row.miniAppId,
    name: row.name,
    enabled: row.enabled !== false,
    isDefault: row.isDefault === true,
    appSecret: row.appSecret ?? '',
    wechatPay: {
      enabled: row.wechatPay?.enabled === true,
      mchId: row.wechatPay?.mchId ?? '',
      serialNo: row.wechatPay?.serialNo ?? '',
      privateKey: row.wechatPay?.privateKey ?? '',
      apiV3Key: row.wechatPay?.apiV3Key ?? '',
      notifyUrl: row.wechatPay?.notifyUrl ?? '',
      baseUrl: row.wechatPay?.baseUrl ?? 'https://api.mch.weixin.qq.com',
      platformPublicKey: row.wechatPay?.platformPublicKey ?? '',
      callbackSkipVerifyInDev: row.wechatPay?.callbackSkipVerifyInDev === true,
      mockPlatformPrivateKey: row.wechatPay?.mockPlatformPrivateKey ?? '',
    },
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

export async function listMiniApps(ctx: Context): Promise<void> {
  const { keyword = '', enabled } = ctx.query as Record<string, string>
  const filter: Record<string, unknown> = {}
  const safeKeyword = keyword.trim()
  if (safeKeyword) {
    filter.$or = [{ miniAppId: new RegExp(safeKeyword, 'i') }, { name: new RegExp(safeKeyword, 'i') }]
  }
  if (enabled === 'true' || enabled === 'false') {
    filter.enabled = enabled === 'true'
  }
  const rows = await MiniAppModel.find(filter).sort({ createdAt: -1 }).lean().exec()
  ctx.body = rows.map(mapMiniApp)
}

export async function getMiniApp(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id?: string }
  const row = await MiniAppModel.findById(id).lean().exec()
  if (!row) {
    ctx.throw(404, 'MiniApp not found')
  }
  ctx.body = mapMiniApp(row)
}

export async function createMiniApp(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as Record<string, any>
  const miniAppId = normalizeString(body.miniAppId)
  const name = normalizeString(body.name)
  const appSecret = normalizeString(body.appSecret)
  if (!miniAppId || !name || !appSecret) {
    ctx.throw(400, 'miniAppId, name and appSecret are required')
  }

  const exists = await MiniAppModel.findOne({ miniAppId }).lean().exec()
  if (exists) {
    ctx.throw(409, 'miniAppId already exists')
  }

  const created = await MiniAppModel.create({
    miniAppId,
    name,
    appSecret,
    enabled: body.enabled !== false,
    isDefault: body.isDefault === true,
    wechatPay: {
      enabled: body.wechatPay?.enabled === true,
      mchId: normalizeString(body.wechatPay?.mchId),
      serialNo: normalizeString(body.wechatPay?.serialNo),
      privateKey: String(body.wechatPay?.privateKey ?? ''),
      apiV3Key: normalizeString(body.wechatPay?.apiV3Key),
      notifyUrl: normalizeString(body.wechatPay?.notifyUrl),
      baseUrl: normalizeString(body.wechatPay?.baseUrl) || 'https://api.mch.weixin.qq.com',
      platformPublicKey: String(body.wechatPay?.platformPublicKey ?? ''),
      callbackSkipVerifyInDev: body.wechatPay?.callbackSkipVerifyInDev === true,
      mockPlatformPrivateKey: String(body.wechatPay?.mockPlatformPrivateKey ?? ''),
    },
  })

  if (created.isDefault) {
    await ensureDefaultConstraint(created._id.toString())
  }

  ctx.status = 201
  ctx.body = mapMiniApp(created)
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
  const appSecret = normalizeString(body.appSecret)
  if (appSecret) {
    row.appSecret = appSecret
  }
  if (typeof body.enabled === 'boolean') {
    row.enabled = body.enabled
  }
  if (typeof body.isDefault === 'boolean') {
    row.isDefault = body.isDefault
  }

  if (body.wechatPay && typeof body.wechatPay === 'object') {
    const pay = body.wechatPay as Record<string, any>
    if (typeof pay.enabled === 'boolean') {
      row.wechatPay.enabled = pay.enabled
    }
    if ('mchId' in pay) {
      row.wechatPay.mchId = normalizeString(pay.mchId)
    }
    if ('serialNo' in pay) {
      row.wechatPay.serialNo = normalizeString(pay.serialNo)
    }
    if ('privateKey' in pay) {
      row.wechatPay.privateKey = String(pay.privateKey ?? '')
    }
    if ('apiV3Key' in pay) {
      row.wechatPay.apiV3Key = normalizeString(pay.apiV3Key)
    }
    if ('notifyUrl' in pay) {
      row.wechatPay.notifyUrl = normalizeString(pay.notifyUrl)
    }
    if ('baseUrl' in pay) {
      row.wechatPay.baseUrl = normalizeString(pay.baseUrl) || 'https://api.mch.weixin.qq.com'
    }
    if ('platformPublicKey' in pay) {
      row.wechatPay.platformPublicKey = String(pay.platformPublicKey ?? '')
    }
    if ('callbackSkipVerifyInDev' in pay) {
      row.wechatPay.callbackSkipVerifyInDev = pay.callbackSkipVerifyInDev === true
    }
    if ('mockPlatformPrivateKey' in pay) {
      row.wechatPay.mockPlatformPrivateKey = String(pay.mockPlatformPrivateKey ?? '')
    }
  }

  await row.save()
  if (row.isDefault) {
    await ensureDefaultConstraint(row._id.toString())
  }

  ctx.body = mapMiniApp(row)
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
  await row.deleteOne()
  ctx.body = { success: true }
}
