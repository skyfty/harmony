import { Types } from 'mongoose'
import { LoginAuditModel } from '@/models/LoginAudit'
import type { LoginAuditDocument } from '@/types/models'

export interface RecordLoginParams {
  userId?: string
  username?: string
  action?: string
  success?: boolean
  ip?: string
  userAgent?: string
  device?: string
  note?: string
}

export async function recordLogin(params: RecordLoginParams): Promise<void> {
  try {
    const doc: Partial<LoginAuditDocument> = {
      action: params.action ?? 'login',
      success: params.success ?? true,
      ip: params.ip,
      userAgent: params.userAgent,
      device: params.device,
      note: params.note,
    }
    if (params.userId && Types.ObjectId.isValid(params.userId)) {
      // @ts-ignore
      doc.userId = new Types.ObjectId(params.userId)
    }
    if (params.username) {
      doc.username = params.username
    }
    await LoginAuditModel.create(doc)
  } catch (err) {
    // Do not block on audit failures; log to console for diagnostics
    // eslint-disable-next-line no-console
    console.error('Failed to write login audit', err)
  }
}

export async function queryLogs(options: {
  page?: number
  pageSize?: number
  username?: string
  userId?: string
  ip?: string
  success?: boolean | string
  start?: string
  end?: string
  keyword?: string
}) {
  const page = Number(options.page ?? 1)
  const pageSize = Number(options.pageSize ?? 20)
  const skip = (page - 1) * pageSize

  const filter: any = {}
  if (options.userId && Types.ObjectId.isValid(options.userId)) {
    filter.userId = new Types.ObjectId(options.userId)
  }
  if (options.username) {
    filter.username = new RegExp(options.username, 'i')
  }
  if (options.ip) {
    filter.ip = new RegExp(options.ip, 'i')
  }
  if (options.success !== undefined && options.success !== null) {
    if (typeof options.success === 'string') {
      filter.success = options.success === 'true'
    } else {
      filter.success = options.success
    }
  }
  if (options.start || options.end) {
    filter.createdAt = {}
    if (options.start) {
      filter.createdAt.$gte = new Date(options.start)
    }
    if (options.end) {
      filter.createdAt.$lte = new Date(options.end)
    }
  }
  if (options.keyword) {
    const kw = new RegExp(options.keyword, 'i')
    filter.$or = [{ username: kw }, { ip: kw }, { userAgent: kw }]
  }

  const [items, total] = await Promise.all([
    LoginAuditModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    LoginAuditModel.countDocuments(filter),
  ])

  return {
    items,
    total,
    page,
    pageSize,
  }
}

export async function getById(id: string) {
  if (!Types.ObjectId.isValid(id)) return null
  return LoginAuditModel.findById(id).lean()
}

export async function deleteById(id: string) {
  if (!Types.ObjectId.isValid(id)) return 0
  const res = await LoginAuditModel.findByIdAndDelete(id).exec()
  return res ? 1 : 0
}

export async function deleteMany(ids: string[]) {
  const valid = ids.filter((id) => Types.ObjectId.isValid(id))
  if (!valid.length) return 0
  const res = await LoginAuditModel.deleteMany({ _id: { $in: valid } })
  // @ts-ignore
  return res.deletedCount ?? 0
}

export async function exportCsv(filterOptions: Parameters<typeof queryLogs>[0]) {
  const { items } = await queryLogs({ ...filterOptions, page: 1, pageSize: 10000 })
  const headers = ['id', 'createdAt', 'username', 'userId', 'action', 'success', 'ip', 'device', 'userAgent', 'note']
  const rows = items.map((it: any) => [
    it._id?.toString?.(),
    it.createdAt?.toISOString?.(),
    it.username ?? '',
    it.userId ? it.userId.toString() : '',
    it.action ?? '',
    it.success ? 'true' : 'false',
    it.ip ?? '',
    it.device ?? '',
    it.userAgent ? it.userAgent.replace(/"/g, '""') : '',
    it.note ? it.note.replace(/"/g, '""') : '',
  ])
  const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c ?? '')}"`).join(','))].join('\n')
  return csv
}
