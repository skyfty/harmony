import type { Context } from 'koa'
import { Types } from 'mongoose'
import { AchievementModel } from '@/models/Achievement'
import { RuleModel } from '@/models/Rule'
import { AchievementRuleModel } from '@/models/AchievementRule'

function mapAchievement(row: any) {
  return {
    id: row._id.toString(),
    name: row.name,
    description: row.description ?? null,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  }
}

export async function listAchievements(ctx: Context): Promise<void> {
  const { page = '1', pageSize = '20', q } = ctx.query as Record<string, string>
  const pageNumber = Math.max(Number(page) || 1, 1)
  const limit = Math.min(Math.max(Number(pageSize) || 20, 1), 200)
  const skip = (pageNumber - 1) * limit

  const filter: Record<string, unknown> = {}
  if (q && q.trim()) {
    filter.$or = [{ name: new RegExp(q.trim(), 'i') }, { description: new RegExp(q.trim(), 'i') }]
  }

  const [rows, total] = await Promise.all([
    AchievementModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
    AchievementModel.countDocuments(filter),
  ])

  ctx.body = {
    data: rows.map(mapAchievement),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function getAchievement(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid id')
  const row = await AchievementModel.findById(id).lean().exec()
  if (!row) ctx.throw(404, 'Achievement not found')
  ctx.body = mapAchievement(row)
}

export async function createAchievement(ctx: Context): Promise<void> {
  const body = (ctx.request.body ?? {}) as any
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) ctx.throw(400, 'name is required')
  const created = await AchievementModel.create({ name, description: body.description ?? null, metadata: body.metadata ?? null })
  const row = await AchievementModel.findById(created._id).lean().exec()
  ctx.status = 201
  ctx.body = mapAchievement(row)
}

export async function updateAchievement(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid id')
  const current = await AchievementModel.findById(id).lean().exec()
  if (!current) ctx.throw(404, 'Achievement not found')
  const body = (ctx.request.body ?? {}) as any
  const next = await AchievementModel.findByIdAndUpdate(
    id,
    { name: body.name ?? current.name, description: body.description === undefined ? current.description : body.description, metadata: body.metadata === undefined ? current.metadata : body.metadata },
    { new: true },
  )
    .lean()
    .exec()
  ctx.body = mapAchievement(next)
}

export async function deleteAchievement(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid id')
  await AchievementModel.findByIdAndDelete(id).exec()
  // remove links
  await AchievementRuleModel.deleteMany({ achievementId: id }).exec()
  ctx.status = 200
  ctx.body = {}
}

// Rules link management
export async function listAchievementRules(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid id')
  const links = await AchievementRuleModel.find({ achievementId: id }).lean().exec()
  const ruleIds = links.map((l: any) => l.ruleId)
  const rules = await RuleModel.find({ _id: { $in: ruleIds } }).lean().exec()
  ctx.body = rules.map((r: any) => ({ id: r._id.toString(), name: r.name, scenicId: r.scenicId?.toString?.() ?? null, enterScenic: r.enterScenic ?? false, viewPercentage: r.viewPercentage ?? 0, enabled: r.enabled ?? true }))
}

export async function addRulesToAchievement(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid id')
  const body = (ctx.request.body ?? {}) as { ruleIds?: string[] }
  const raw = Array.isArray(body.ruleIds) ? body.ruleIds : []
  const valid = Array.from(new Set(raw.filter((v) => Types.ObjectId.isValid(v))))
  if (!valid.length) ctx.throw(400, 'ruleIds is required')
  const docs = valid.map((rid) => ({ achievementId: new Types.ObjectId(id), ruleId: new Types.ObjectId(rid) }))
  try {
    await AchievementRuleModel.insertMany(docs, { ordered: false })
  } catch (error: any) {
    // ignore duplicate key errors
    if (error?.code !== 11000) throw error
  }
  ctx.status = 201
  ctx.body = { added: valid.length }
}

export async function removeRuleFromAchievement(ctx: Context): Promise<void> {
  const { id, ruleId } = ctx.params
  if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(ruleId)) ctx.throw(400, 'Invalid id')
  await AchievementRuleModel.findOneAndDelete({ achievementId: id, ruleId }).exec()
  ctx.status = 200
  ctx.body = {}
}
