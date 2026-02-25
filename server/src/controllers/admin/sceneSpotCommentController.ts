import type { Context } from 'koa'
import { Types } from 'mongoose'
import { AppUserModel } from '@/models/AppUser'
import { SceneSpotCommentModel } from '@/models/SceneSpotComment'
import { SceneSpotModel } from '@/models/SceneSpot'

const COMMENT_CONTENT_MAX_LENGTH = 500
const COMMENT_STATUSES = new Set(['pending', 'approved', 'rejected'])

function toSafePage(value: unknown, fallback = 1): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback
  }
  return parsed
}

function toSafePageSize(value: unknown, fallback = 20): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback
  }
  return Math.min(parsed, 100)
}

function normalizeContent(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function ensureValidStatus(status: unknown): string {
  if (typeof status !== 'string') {
    throw new Error('Invalid comment status')
  }
  const normalized = status.trim()
  if (!COMMENT_STATUSES.has(normalized)) {
    throw new Error('Invalid comment status')
  }
  return normalized
}

function toCommentDto(comment: any, userDisplayName?: string, sceneSpotTitle?: string) {
  return {
    id: String(comment._id),
    sceneSpotId: String(comment.sceneSpotId),
    sceneSpotTitle: sceneSpotTitle || '',
    userId: String(comment.userId),
    userDisplayName: userDisplayName || '',
    content: String(comment.content || ''),
    status: String(comment.status || 'pending'),
    rejectReason: typeof comment.rejectReason === 'string' ? comment.rejectReason : null,
    reviewedAt: comment.reviewedAt ? new Date(comment.reviewedAt).toISOString() : null,
    reviewedBy: comment.reviewedBy ? String(comment.reviewedBy) : null,
    editedAt: comment.editedAt ? new Date(comment.editedAt).toISOString() : null,
    editedBy: comment.editedBy ? String(comment.editedBy) : null,
    createdAt: comment.createdAt ? new Date(comment.createdAt).toISOString() : null,
    updatedAt: comment.updatedAt ? new Date(comment.updatedAt).toISOString() : null,
  }
}

async function collectUserNameMap(userIds: string[]): Promise<Map<string, string>> {
  const deduped = Array.from(new Set(userIds.filter((id) => Types.ObjectId.isValid(id))))
  if (!deduped.length) {
    return new Map()
  }
  const users = await AppUserModel.find({ _id: { $in: deduped } }, { _id: 1, displayName: 1, username: 1 })
    .lean()
    .exec()
  const map = new Map<string, string>()
  for (const user of users as Array<{ _id: Types.ObjectId; displayName?: string; username?: string }>) {
    map.set(String(user._id), user.displayName || user.username || '匿名用户')
  }
  return map
}

async function collectSceneSpotTitleMap(sceneSpotIds: string[]): Promise<Map<string, string>> {
  const deduped = Array.from(new Set(sceneSpotIds.filter((id) => Types.ObjectId.isValid(id))))
  if (!deduped.length) {
    return new Map()
  }
  const spots = await SceneSpotModel.find({ _id: { $in: deduped } }, { _id: 1, title: 1 }).lean().exec()
  const map = new Map<string, string>()
  for (const spot of spots as Array<{ _id: Types.ObjectId; title?: string }>) {
    map.set(String(spot._id), spot.title || '')
  }
  return map
}

export async function listSceneSpotComments(ctx: Context): Promise<void> {
  const {
    page = '1',
    pageSize = '20',
    keyword,
    sceneSpotId,
    status,
  } = ctx.query as Record<string, string>

  const pageNumber = toSafePage(page, 1)
  const size = toSafePageSize(pageSize, 20)
  const skip = (pageNumber - 1) * size

  const query: Record<string, unknown> = {}
  if (typeof sceneSpotId === 'string' && sceneSpotId.trim()) {
    if (!Types.ObjectId.isValid(sceneSpotId.trim())) {
      ctx.throw(400, 'Invalid scene spot id')
    }
    query.sceneSpotId = sceneSpotId.trim()
  }
  if (typeof status === 'string' && status.trim()) {
    try {
      query.status = ensureValidStatus(status)
    } catch {
      ctx.throw(400, 'Invalid comment status')
    }
  }
  if (typeof keyword === 'string' && keyword.trim()) {
    query.content = new RegExp(keyword.trim(), 'i')
  }

  const [total, rows] = await Promise.all([
    SceneSpotCommentModel.countDocuments(query),
    SceneSpotCommentModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(size).lean().exec(),
  ])

  const userMap = await collectUserNameMap(rows.map((row) => String(row.userId)))
  const sceneSpotMap = await collectSceneSpotTitleMap(rows.map((row) => String(row.sceneSpotId)))

  ctx.body = {
    data: rows.map((row) =>
      toCommentDto(row, userMap.get(String(row.userId)), sceneSpotMap.get(String(row.sceneSpotId))),
    ),
    total,
    page: pageNumber,
    pageSize: size,
  }
}

export async function listSceneSpotCommentsBySceneSpot(ctx: Context): Promise<void> {
  const { sceneSpotId } = ctx.params as { sceneSpotId: string }
  if (!Types.ObjectId.isValid(sceneSpotId)) {
    ctx.throw(400, 'Invalid scene spot id')
  }

  const mergedQuery = {
    ...(ctx.query as Record<string, unknown>),
    sceneSpotId,
  }
  ctx.query = mergedQuery
  await listSceneSpotComments(ctx)
}

export async function getSceneSpotComment(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid comment id')
  }

  const comment = await SceneSpotCommentModel.findById(id).lean().exec()
  if (!comment) {
    ctx.throw(404, 'Comment not found')
  }

  const [userMap, spotMap] = await Promise.all([
    collectUserNameMap([String(comment.userId)]),
    collectSceneSpotTitleMap([String(comment.sceneSpotId)]),
  ])

  ctx.body = toCommentDto(comment, userMap.get(String(comment.userId)), spotMap.get(String(comment.sceneSpotId)))
}

export async function createSceneSpotCommentByAdmin(ctx: Context): Promise<void> {
  const adminId = ctx.state.adminAuthUser?.id
  const adminObjectId = adminId && Types.ObjectId.isValid(adminId) ? new Types.ObjectId(adminId) : null
  const { sceneSpotId, userId, content, status = 'approved', rejectReason } = ctx.request.body as {
    sceneSpotId?: string
    userId?: string
    content?: string
    status?: string
    rejectReason?: string
  }

  if (!sceneSpotId || !Types.ObjectId.isValid(sceneSpotId)) {
    ctx.throw(400, 'Invalid scene spot id')
  }
  if (!userId || !Types.ObjectId.isValid(userId)) {
    ctx.throw(400, 'Invalid user id')
  }

  const normalizedContent = normalizeContent(content)
  if (!normalizedContent) {
    ctx.throw(400, 'Comment content is required')
  }
  if (normalizedContent.length > COMMENT_CONTENT_MAX_LENGTH) {
    ctx.throw(400, `Comment content cannot exceed ${COMMENT_CONTENT_MAX_LENGTH} characters`)
  }

  let normalizedStatus: string
  try {
    normalizedStatus = ensureValidStatus(status)
  } catch {
    ctx.throw(400, 'Invalid comment status')
    return
  }

  const [spotExists, userExists] = await Promise.all([
    SceneSpotModel.exists({ _id: sceneSpotId }),
    AppUserModel.exists({ _id: userId }),
  ])
  if (!spotExists) {
    ctx.throw(404, 'Scene spot not found')
  }
  if (!userExists) {
    ctx.throw(404, 'User not found')
  }

  const now = new Date()
  const created = await SceneSpotCommentModel.create({
    sceneSpotId,
    userId,
    content: normalizedContent,
    status: normalizedStatus,
    rejectReason: normalizedStatus === 'rejected' ? normalizeContent(rejectReason) || null : null,
    reviewedAt: normalizedStatus === 'pending' ? null : now,
    reviewedBy: normalizedStatus === 'pending' ? null : adminObjectId,
    editedAt: now,
    editedBy: adminObjectId,
  })

  const [userMap, spotMap] = await Promise.all([
    collectUserNameMap([String(created.userId)]),
    collectSceneSpotTitleMap([String(created.sceneSpotId)]),
  ])

  ctx.status = 201
  ctx.body = toCommentDto(created.toObject(), userMap.get(String(created.userId)), spotMap.get(String(created.sceneSpotId)))
}

export async function updateSceneSpotComment(ctx: Context): Promise<void> {
  const adminId = ctx.state.adminAuthUser?.id
  const adminObjectId = adminId && Types.ObjectId.isValid(adminId) ? new Types.ObjectId(adminId) : null
  const { id } = ctx.params as { id: string }
  const { content } = ctx.request.body as { content?: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid comment id')
  }

  const normalizedContent = normalizeContent(content)
  if (!normalizedContent) {
    ctx.throw(400, 'Comment content is required')
  }
  if (normalizedContent.length > COMMENT_CONTENT_MAX_LENGTH) {
    ctx.throw(400, `Comment content cannot exceed ${COMMENT_CONTENT_MAX_LENGTH} characters`)
  }

  const comment = await SceneSpotCommentModel.findById(id).exec()
  if (!comment) {
    ctx.throw(404, 'Comment not found')
  }

  comment.content = normalizedContent
  comment.editedAt = new Date()
  comment.editedBy = adminObjectId
  await comment.save()

  const [userMap, spotMap] = await Promise.all([
    collectUserNameMap([String(comment.userId)]),
    collectSceneSpotTitleMap([String(comment.sceneSpotId)]),
  ])

  ctx.body = toCommentDto(comment.toObject(), userMap.get(String(comment.userId)), spotMap.get(String(comment.sceneSpotId)))
}

export async function updateSceneSpotCommentStatus(ctx: Context): Promise<void> {
  const adminId = ctx.state.adminAuthUser?.id
  const adminObjectId = adminId && Types.ObjectId.isValid(adminId) ? new Types.ObjectId(adminId) : null
  const { id } = ctx.params as { id: string }
  const { status, rejectReason } = ctx.request.body as { status?: string; rejectReason?: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid comment id')
  }

  let normalizedStatus: string
  try {
    normalizedStatus = ensureValidStatus(status)
  } catch {
    ctx.throw(400, 'Invalid comment status')
    return
  }

  const comment = await SceneSpotCommentModel.findById(id).exec()
  if (!comment) {
    ctx.throw(404, 'Comment not found')
  }

  comment.status = normalizedStatus as any
  comment.rejectReason = normalizedStatus === 'rejected' ? normalizeContent(rejectReason) || null : null
  comment.reviewedAt = normalizedStatus === 'pending' ? null : new Date()
  comment.reviewedBy = normalizedStatus === 'pending' ? null : adminObjectId
  await comment.save()

  const [userMap, spotMap] = await Promise.all([
    collectUserNameMap([String(comment.userId)]),
    collectSceneSpotTitleMap([String(comment.sceneSpotId)]),
  ])

  ctx.body = toCommentDto(comment.toObject(), userMap.get(String(comment.userId)), spotMap.get(String(comment.sceneSpotId)))
}

export async function deleteSceneSpotComment(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid comment id')
  }

  const deleted = await SceneSpotCommentModel.findByIdAndDelete(id).lean().exec()
  if (!deleted) {
    ctx.throw(404, 'Comment not found')
  }
  ctx.body = {}
}
