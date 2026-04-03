import type { Context } from 'koa'
import { Types } from 'mongoose'
import { MedalModel } from '@/models/Medal'
import { UserMedalModel } from '@/models/UserMedal'
import type { MedalRule, MedalRuleCompleteType, MedalRuleScope, MedalRuleType } from '@/types/models'

const MEDAL_RULE_TYPES: MedalRuleType[] = [
  'enter_scenic',
  'punch_ratio_gte',
  'enter_count_gte',
  'punch_count_gte',
  'specific_scenic_set_complete',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toNullableString(value: unknown): null | string {
  const trimmed = toTrimmedString(value)
  return trimmed || null
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return value !== 0
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') {
      return true
    }
    if (normalized === 'false' || normalized === '0') {
      return false
    }
  }
  return fallback
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toPositiveInt(value: unknown, fallback = 1): number {
  const parsed = Math.floor(toNumber(value, fallback))
  return parsed > 0 ? parsed : fallback
}

function toPercent(value: unknown): number {
  const parsed = toNumber(value)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return Math.max(0, Math.min(100, parsed))
}

function toScope(value: unknown): MedalRuleScope {
  return value === 'specific_scenic' ? 'specific_scenic' : 'any_scenic'
}

function toCompleteType(value: unknown): MedalRuleCompleteType {
  return value === 'punch_ratio_gte' ? 'punch_ratio_gte' : 'enter_scenic'
}

function normalizeRule(rawRule: unknown, index: number): MedalRule {
  if (!isRecord(rawRule)) {
    throw new Error(`rules[${index}] is invalid`)
  }

  const rawType = toTrimmedString(rawRule.type)
  if (!MEDAL_RULE_TYPES.includes(rawType as MedalRuleType)) {
    throw new Error(`rules[${index}].type is invalid`)
  }
  const type = rawType as MedalRuleType

  const params = isRecord(rawRule.params) ? rawRule.params : {}

  switch (type) {
    case 'enter_scenic':
    case 'punch_ratio_gte': {
      const scope = toScope(params.scope)
      const scenicId = toTrimmedString(params.scenicId)
      const scenicCount = scope === 'specific_scenic' ? 1 : toPositiveInt(params.scenicCount, 1)
      if (scope === 'specific_scenic' && !Types.ObjectId.isValid(scenicId)) {
        throw new Error(`rules[${index}].params.scenicId is required`)
      }
      const normalizedParams: Record<string, unknown> = {
        scope,
        scenicId: scope === 'specific_scenic' ? scenicId : null,
        scenicCount,
        conditionValue: type === 'punch_ratio_gte' ? toPercent(params.conditionValue) : null,
      }
      return { type, params: normalizedParams, order: index }
    }
    case 'enter_count_gte':
    case 'punch_count_gte': {
      return {
        type,
        params: { threshold: toPositiveInt(params.threshold, 1) },
        order: index,
      }
    }
    case 'specific_scenic_set_complete': {
      const scenicIds = Array.isArray(params.scenicIds)
        ? Array.from(new Set(params.scenicIds.map((item) => toTrimmedString(item)).filter((item) => Types.ObjectId.isValid(item))))
        : []
      if (!scenicIds.length) {
        throw new Error(`rules[${index}].params.scenicIds is required`)
      }
      const completeType = toCompleteType(params.completeType)
      return {
        type,
        params: {
          scenicIds,
          completeType,
          completeValue: completeType === 'punch_ratio_gte' ? toPercent(params.completeValue) : null,
        },
        order: index,
      }
    }
    default: {
      throw new Error(`rules[${index}].type is unsupported`)
    }
  }
}

function normalizeRules(rawRules: unknown): MedalRule[] {
  if (!Array.isArray(rawRules) || !rawRules.length) {
    throw new Error('rules is required')
  }
  return rawRules.map((rule, index) => normalizeRule(rule, index))
}

function mapMedal(row: any) {
  return {
    id: row._id.toString(),
    name: row.name,
    description: row.description ?? null,
    lockedIconUrl: row.lockedIconUrl ?? null,
    unlockedIconUrl: row.unlockedIconUrl ?? null,
    enabled: row.enabled !== false,
    sort: Number.isFinite(Number(row.sort)) ? Number(row.sort) : 0,
    rules: Array.isArray(row.rules) ? row.rules : [],
    ruleCount: Array.isArray(row.rules) ? row.rules.length : 0,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  }
}

function mapUserMedalStatus(row: any, userMedal: any) {
  return {
    ...mapMedal(row),
    awarded: Boolean(userMedal),
    awardedAt: userMedal?.awardedAt?.toISOString?.() ?? (userMedal?.awardedAt ? new Date(userMedal.awardedAt).toISOString() : null),
    userMedalId: userMedal?._id?.toString?.() ?? null,
  }
}

export async function listMedals(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '20', q } = ctx.query as Record<string, string>
  const pageNumber = Math.max(Number(page) || 1, 1)
  const limit = Math.min(Math.max(Number(pageSize) || 20, 1), 200)
  const skip = (pageNumber - 1) * limit

  const filter: Record<string, unknown> = {}
  if (q && q.trim()) {
    filter.$or = [{ name: new RegExp(q.trim(), 'i') }, { description: new RegExp(q.trim(), 'i') }]
  }

  const [rows, total] = await Promise.all([
    MedalModel.find(filter).sort({ sort: 1, createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
    MedalModel.countDocuments(filter),
  ])

  ctx.body = {
    data: rows.map(mapMedal),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function getMedal(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid id')
  const row = await MedalModel.findById(id).lean().exec()
  if (!row) ctx.throw(404, 'Medal not found')
  ctx.body = mapMedal(row)
}

export async function listUserMedals(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid user id')

  const { page = '1', pageSize = '20', q } = ctx.query as Record<string, string>
  const pageNumber = Math.max(Number(page) || 1, 1)
  const limit = Math.min(Math.max(Number(pageSize) || 20, 1), 200)
  const skip = (pageNumber - 1) * limit

  const filter: Record<string, unknown> = {}
  if (q && q.trim()) {
    filter.$or = [{ name: new RegExp(q.trim(), 'i') }, { description: new RegExp(q.trim(), 'i') }]
  }

  const [rows, total] = await Promise.all([
    MedalModel.find(filter).sort({ sort: 1, createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
    MedalModel.countDocuments(filter),
  ])

  const medalIds = rows.map((row: any) => row._id)
  const userMedalRows = medalIds.length
    ? await UserMedalModel.find({
        userId: new Types.ObjectId(id),
        medalId: { $in: medalIds },
      })
        .lean()
        .exec()
    : []

  const userMedalMap = new Map(userMedalRows.map((row: any) => [row.medalId?.toString?.() ?? '', row]))

  ctx.body = {
    data: rows.map((row: any) => mapUserMedalStatus(row, userMedalMap.get(row._id.toString()))),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function createMedal(ctx: Context): Promise<void> {
  // TEMP DEBUG: log request metadata to diagnose "stream is not readable" errors
  try {
    console.debug('[medal:create] headers:', ctx.request.header || ctx.headers)
    console.debug('[medal:create] is multipart:', ctx.is('multipart'))
    console.debug('[medal:create] request type:', ctx.request.type)
    // ctx.req is a Node IncomingMessage
    // readable may be false if the stream has been consumed or closed
    // @ts-ignore
    console.debug('[medal:create] req.readable:', typeof ctx.req?.readable === 'boolean' ? ctx.req.readable : 'unknown')
  } catch (e) {
    console.warn('[medal:create] failed to log request debug info', e)
  }

  const body = isRecord(ctx.request.body) ? ctx.request.body : {}
  const name = toTrimmedString(body.name)
  if (!name) ctx.throw(400, 'name is required')

  let rules: MedalRule[]
  try {
    rules = normalizeRules(body.rules)
  } catch (error: any) {
    ctx.throw(400, error?.message || 'rules is invalid')
    return
  }

  const created = await MedalModel.create({
    name,
    description: toNullableString(body.description),
    lockedIconUrl: toNullableString(body.lockedIconUrl),
    unlockedIconUrl: toNullableString(body.unlockedIconUrl),
    enabled: toBoolean(body.enabled, true),
    sort: toNumber(body.sort, 0),
    rules: rules as any,
    metadata: isRecord(body.metadata) ? body.metadata : null,
  })
  const row = await MedalModel.findById(created._id).lean().exec()
  ctx.status = 201
  ctx.body = mapMedal(row)
}

export async function updateMedal(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid id')
  const current = await MedalModel.findById(id).lean().exec()
  if (!current) ctx.throw(404, 'Medal not found')

  const body = isRecord(ctx.request.body) ? ctx.request.body : {}
  let rules: MedalRule[] = Array.isArray(current.rules) ? (current.rules as unknown as MedalRule[]) : []
  if (body.rules !== undefined) {
    try {
      rules = normalizeRules(body.rules)
    } catch (error: any) {
      ctx.throw(400, error?.message || 'rules is invalid')
      return
    }
  }

  const row = await MedalModel.findByIdAndUpdate(
    id,
    {
      name: body.name === undefined ? current.name : toTrimmedString(body.name) || current.name,
      description: body.description === undefined ? current.description : toNullableString(body.description),
      lockedIconUrl: body.lockedIconUrl === undefined ? current.lockedIconUrl : toNullableString(body.lockedIconUrl),
      unlockedIconUrl: body.unlockedIconUrl === undefined ? current.unlockedIconUrl : toNullableString(body.unlockedIconUrl),
      enabled: body.enabled === undefined ? current.enabled : toBoolean(body.enabled, current.enabled),
      sort: body.sort === undefined ? current.sort : toNumber(body.sort, current.sort),
      rules: rules as any,
      metadata: body.metadata === undefined ? current.metadata : isRecord(body.metadata) ? body.metadata : null,
    },
    { new: true },
  )
    .lean()
    .exec()

  ctx.body = mapMedal(row)
}

export async function deleteMedal(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid id')
  await Promise.all([
    MedalModel.findByIdAndDelete(id).exec(),
    UserMedalModel.deleteMany({ medalId: new Types.ObjectId(id) }).exec(),
  ])
  ctx.body = {}
}