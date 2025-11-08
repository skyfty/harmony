import type { Context } from 'koa'
import { Types } from 'mongoose'
import { ExhibitionModel } from '@/models/Exhibition'
import { ensureUserId, getOptionalUserId } from './utils'
import { fetchWorkResponsesByIds, type WorkResponse } from './workHelpers'

interface ExhibitionInput {
  name?: string
  description?: string
  coverUrl?: string
  startDate?: string
  endDate?: string
  workIds?: string[]
  status?: 'draft' | 'published' | 'withdrawn'
}

interface ExhibitionLean {
  _id: Types.ObjectId
  ownerId: Types.ObjectId
  name: string
  description?: string
  coverUrl?: string
  startDate?: Date
  endDate?: Date
  workIds: Types.ObjectId[]
  status: 'draft' | 'published' | 'withdrawn'
  likes: Types.ObjectId[]
  ratings: Array<{
    userId: Types.ObjectId
    score: number
    comment?: string
    createdAt: Date
    updatedAt: Date
  }>
  visits: Array<{
    userId: Types.ObjectId
    visitedAt: Date
  }>
  shareCount: number
  createdAt: Date
  updatedAt: Date
}

type ExhibitionRatingLean = ExhibitionLean['ratings'][number]
type ExhibitionVisitLean = ExhibitionLean['visits'][number]

interface ExhibitionResponse {
  id: string
  name: string
  description?: string
  coverUrl?: string
  status: 'draft' | 'published' | 'withdrawn'
  startDate?: string
  endDate?: string
  works: WorkResponse[]
  workCount: number
  likesCount: number
  liked: boolean
  ratingCount: number
  averageRating: number
  userRating?: {
    score: number
    comment?: string
  }
  visitCount: number
  visited: boolean
  shareCount: number
  createdAt: string
  updatedAt: string
}

function parseDate(value?: string): Date | undefined {
  if (!value) {
    return undefined
  }
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return undefined
  }
  return new Date(timestamp)
}

function buildExhibitionResponse(
  exhibition: ExhibitionLean,
  works: WorkResponse[],
  userId?: string,
): ExhibitionResponse {
  const ratingCount = exhibition.ratings.length
  const averageRating = ratingCount
    ? exhibition.ratings.reduce((sum, rating) => sum + rating.score, 0) / ratingCount
    : 0
  const userRating = userId
    ? exhibition.ratings.find((rating) => rating.userId.toString() === userId)
    : undefined
  const liked = Boolean(userId && exhibition.likes.some((id) => id.toString() === userId))
  const visited = Boolean(userId && exhibition.visits.some((visit) => visit.userId.toString() === userId))
  return {
    id: exhibition._id.toString(),
    name: exhibition.name,
    description: exhibition.description ?? undefined,
    coverUrl: exhibition.coverUrl ?? undefined,
    status: exhibition.status,
    startDate: exhibition.startDate ? exhibition.startDate.toISOString() : undefined,
    endDate: exhibition.endDate ? exhibition.endDate.toISOString() : undefined,
    works,
    workCount: works.length,
    likesCount: exhibition.likes.length,
    liked,
    ratingCount,
    averageRating: Number(averageRating.toFixed(2)),
    userRating: userRating
      ? {
          score: userRating.score,
          comment: userRating.comment ?? undefined,
        }
      : undefined,
    visitCount: exhibition.visits.length,
    visited,
    shareCount: exhibition.shareCount,
    createdAt: exhibition.createdAt.toISOString(),
    updatedAt: exhibition.updatedAt.toISOString(),
  }
}

function normalizeWorkIds(ids?: string[]): Types.ObjectId[] {
  if (!Array.isArray(ids)) {
    return []
  }
  return ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id))
}

export async function createExhibition(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const body = ctx.request.body as ExhibitionInput
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    ctx.throw(400, 'Exhibition name is required')
  }
  const workIds = normalizeWorkIds(body.workIds)
  const exhibition = await ExhibitionModel.create({
    ownerId: new Types.ObjectId(userId),
    name,
    description: body.description ?? '',
    coverUrl: body.coverUrl,
    startDate: parseDate(body.startDate),
    endDate: parseDate(body.endDate),
    workIds,
    status: body.status ?? 'published',
  })
  const works = await fetchWorkResponsesByIds(workIds, userId)
  ctx.status = 201
  ctx.body = buildExhibitionResponse(exhibition.toObject() as ExhibitionLean, works, userId)
}

export async function listExhibitions(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { owner, scope } = ctx.query as { owner?: string; scope?: string }
  const filter: Record<string, unknown> = {}
  if (scope === 'all') {
    // no owner filter when requesting all exhibitions
  } else if (!owner || owner === 'me') {
    filter.ownerId = new Types.ObjectId(userId)
  } else if (Types.ObjectId.isValid(owner)) {
    filter.ownerId = new Types.ObjectId(owner)
  }
  const exhibitions = (await ExhibitionModel.find(filter)
    .sort({ createdAt: -1 })
    .lean()
    .exec()) as ExhibitionLean[]
  const data: ExhibitionResponse[] = []
  for (const exhibition of exhibitions) {
  const works = await fetchWorkResponsesByIds(exhibition.workIds ?? [], userId)
    data.push(buildExhibitionResponse(exhibition, works, userId))
  }
  ctx.body = {
    total: data.length,
    exhibitions: data,
  }
}

export async function getExhibition(ctx: Context): Promise<void> {
  const userId = getOptionalUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid exhibition id')
  }
  const exhibition = (await ExhibitionModel.findById(id)
    .lean()
    .exec()) as ExhibitionLean | null
  if (!exhibition) {
    ctx.throw(404, 'Exhibition not found')
    return
  }
  const works = await fetchWorkResponsesByIds(exhibition.workIds ?? [], userId)
  ctx.body = buildExhibitionResponse(exhibition, works, userId)
}

export async function updateExhibition(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid exhibition id')
  }
  const body = ctx.request.body as ExhibitionInput
  const exhibition = await ExhibitionModel.findOne({ _id: id, ownerId: userId }).exec()
  if (!exhibition) {
    ctx.throw(404, 'Exhibition not found')
    return
  }
  if (typeof body.name === 'string' && body.name.trim()) {
    exhibition.name = body.name.trim()
  }
  if (typeof body.description === 'string') {
    exhibition.description = body.description
  }
  if (typeof body.coverUrl === 'string') {
    exhibition.coverUrl = body.coverUrl
  }
  if (typeof body.startDate === 'string') {
    const parsed = parseDate(body.startDate)
    exhibition.startDate = parsed ?? exhibition.startDate
  }
  if (typeof body.endDate === 'string') {
    const parsed = parseDate(body.endDate)
    exhibition.endDate = parsed ?? exhibition.endDate
  }
  if (Array.isArray(body.workIds)) {
    exhibition.workIds = normalizeWorkIds(body.workIds)
  }
  if (body.status === 'draft' || body.status === 'published' || body.status === 'withdrawn') {
    exhibition.status = body.status
  }
  await exhibition.save()
  const works = await fetchWorkResponsesByIds(exhibition.workIds ?? [], userId)
  ctx.body = buildExhibitionResponse(exhibition.toObject() as ExhibitionLean, works, userId)
}

export async function deleteExhibition(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid exhibition id')
  }
  const exhibition = await ExhibitionModel.findOneAndDelete({ _id: id, ownerId: userId }).exec()
  if (!exhibition) {
    ctx.throw(404, 'Exhibition not found')
    return
  }
  ctx.body = { success: true }
}

export async function withdrawExhibition(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid exhibition id')
  }
  const exhibition = await ExhibitionModel.findOneAndUpdate(
    { _id: id, ownerId: userId },
    { status: 'withdrawn' },
    { new: true },
  )
    .lean()
    .exec() as ExhibitionLean | null
  if (!exhibition) {
    ctx.throw(404, 'Exhibition not found')
    return
  }
  const works = await fetchWorkResponsesByIds(exhibition.workIds ?? [], userId)
  ctx.body = buildExhibitionResponse(exhibition, works, userId)
}

export async function toggleExhibitionLike(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid exhibition id')
  }
  const exhibition = await ExhibitionModel.findById(id).exec()
  if (!exhibition) {
    ctx.throw(404, 'Exhibition not found')
    return
  }
  const alreadyLiked = exhibition.likes.some((like: Types.ObjectId) => like.toString() === userId)
  if (alreadyLiked) {
    exhibition.likes = exhibition.likes.filter((like: Types.ObjectId) => like.toString() !== userId)
  } else {
    exhibition.likes.push(new Types.ObjectId(userId))
  }
  await exhibition.save()
  ctx.body = {
    liked: !alreadyLiked,
    likesCount: exhibition.likes.length,
  }
}

export async function rateExhibition(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  const { score, comment } = ctx.request.body as { score?: number; comment?: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid exhibition id')
  }
  if (typeof score !== 'number' || Number.isNaN(score) || score < 1 || score > 5) {
    ctx.throw(400, 'Score must be between 1 and 5')
  }
  const exhibition = await ExhibitionModel.findById(id).exec()
  if (!exhibition) {
    ctx.throw(404, 'Exhibition not found')
    return
  }
  const now = new Date()
  const existing = exhibition.ratings.find((rating: ExhibitionRatingLean) => rating.userId.toString() === userId)
  if (existing) {
    existing.score = score
    existing.comment = comment ?? existing.comment
    existing.updatedAt = now
  } else {
    exhibition.ratings.push({
      userId: new Types.ObjectId(userId),
      score,
      comment,
      createdAt: now,
      updatedAt: now,
    })
  }
  await exhibition.save()
  const works = await fetchWorkResponsesByIds(exhibition.workIds ?? [], userId)
  ctx.body = buildExhibitionResponse(exhibition.toObject() as ExhibitionLean, works, userId)
}

export async function visitExhibition(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid exhibition id')
  }
  const exhibition = await ExhibitionModel.findById(id).exec()
  if (!exhibition) {
    ctx.throw(404, 'Exhibition not found')
    return
  }
  const now = new Date()
  const existing = exhibition.visits.find((visit: ExhibitionVisitLean) => visit.userId.toString() === userId)
  if (existing) {
    existing.visitedAt = now
  } else {
    exhibition.visits.push({ userId: new Types.ObjectId(userId), visitedAt: now })
  }
  await exhibition.save()
  ctx.body = {
    visitedAt: now.toISOString(),
    visitCount: exhibition.visits.length,
  }
}

export async function shareExhibition(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid exhibition id')
  }
  const exhibition = await ExhibitionModel.findOneAndUpdate(
    { _id: id },
    { $inc: { shareCount: 1 } },
    { new: true },
  )
    .lean()
    .exec() as ExhibitionLean | null
  if (!exhibition) {
    ctx.throw(404, 'Exhibition not found')
    return
  }
  ctx.body = {
    shareCount: exhibition.shareCount,
  }
}
