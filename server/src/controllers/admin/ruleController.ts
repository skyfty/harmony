import type { Context } from 'koa'
import { Types } from 'mongoose'
import { RuleModel } from '@/models/Rule'
import { AchievementRuleModel } from '@/models/AchievementRule'

function mapRule(row: any) {
  return {
    id: row._id.toString(),
    name: row.name,
    scenicId: row.scenicId?.toString?.() ?? null,
    enterScenic: !!row.enterScenic,
    viewPercentage: row.viewPercentage ?? 0,
    enabled: row.enabled ?? true,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  }
}

export async function listRules(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '20', q } = ctx.query as Record<string, string>
  const pageNumber = Math.max(Number(page) || 1, 1)
  const limit = Math.min(Math.max(Number(pageSize) || 20, 1), 200)
  const skip = (pageNumber - 1) * limit

  const filter: Record<string, unknown> = {}
  if (q && q.trim()) filter.$or = [{ name: new RegExp(q.trim(), 'i') }]

  const [rows, total] = await Promise.all([
    RuleModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
    RuleModel.countDocuments(filter),
  ])

  ctx.body = { data: rows.map(mapRule), page: pageNumber, pageSize: limit, total }
}

export async function getRule(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid id')
  const row = await RuleModel.findById(id).lean().exec()
  if (!row) ctx.throw(404, 'Rule not found')
  ctx.body = mapRule(row)
}

export async function createRule(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as any
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) ctx.throw(400, 'name is required')
  const scenicId = Types.ObjectId.isValid(body.scenicId) ? new Types.ObjectId(body.scenicId) : null
  const created = await RuleModel.create({ name, scenicId, enterScenic: !!body.enterScenic, viewPercentage: typeof body.viewPercentage === 'number' ? body.viewPercentage : 0, enabled: body.enabled === undefined ? true : !!body.enabled, metadata: body.metadata ?? null })
  const row = await RuleModel.findById(created._id).lean().exec()
  ctx.status = 201
  ctx.body = mapRule(row)
}

export async function updateRule(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid id')
  const current = await RuleModel.findById(id).lean().exec()
  if (!current) ctx.throw(404, 'Rule not found')
  const body = (ctx.request.body ?? {}) as any
  const scenicId = body.scenicId === undefined ? current.scenicId : Types.ObjectId.isValid(body.scenicId) ? new Types.ObjectId(body.scenicId) : null
  const updated = await RuleModel.findByIdAndUpdate(
    id,
    {
      name: body.name ?? current.name,
      scenicId,
      enterScenic: body.enterScenic === undefined ? current.enterScenic : !!body.enterScenic,
      viewPercentage: body.viewPercentage === undefined ? current.viewPercentage : Number(body.viewPercentage) || 0,
      enabled: body.enabled === undefined ? current.enabled : !!body.enabled,
      metadata: body.metadata === undefined ? current.metadata : body.metadata,
    },
    { new: true },
  )
    .lean()
    .exec()
  ctx.body = mapRule(updated)
}

export async function deleteRule(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid id')
  await RuleModel.findByIdAndDelete(id).exec()
  // remove links
  await AchievementRuleModel.deleteMany({ ruleId: id }).exec()
  ctx.status = 200
  ctx.body = {}
}
