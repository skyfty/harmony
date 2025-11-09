import type { Context } from 'koa'
import { Types } from 'mongoose'
import { ExhibitionModel } from '@/models/Exhibition'
import { WorkCollectionModel } from '@/models/WorkCollection'
import { ensureUserId, getOptionalUserId } from './utils'
import { fetchWorkResponsesByIds, type WorkResponse } from './workHelpers'

interface ExhibitionInput {
  name?: string
  description?: string
  coverUrl?: string
  coverUrls?: string[]
  startDate?: string
  endDate?: string
  workIds?: string[]
  collectionIds?: string[]
  status?: 'draft' | 'published' | 'withdrawn'
}

interface ExhibitionLean {
  _id: Types.ObjectId
  ownerId: Types.ObjectId
  name: string
  description?: string
  coverUrl?: string
  coverUrls?: string[]
  startDate?: Date
  endDate?: Date
  workIds: Types.ObjectId[]
  collectionIds: Types.ObjectId[]
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

interface CollectionLean {
  _id: Types.ObjectId
  title: string
  description?: string
  coverUrl?: string
  workIds?: Types.ObjectId[]
}

interface CollectionResponse {
  id: string
  title: string
  description?: string
  coverUrl?: string
  workCount: number
}

interface ExhibitionResponse {
  ownerId: string
  id: string
  name: string
  description?: string
  coverUrl?: string
  coverUrls: string[]
  status: 'draft' | 'published' | 'withdrawn'
  startDate?: string
  endDate?: string
  works: WorkResponse[]
  workCount: number
  collections: CollectionResponse[]
  collectionIds: string[]
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

function normalizeObjectIds(ids?: string[]): Types.ObjectId[] {
  if (!Array.isArray(ids)) {
    return []
  }
  const seen = new Set<string>()
  const result: Types.ObjectId[] = []
  ids.forEach((value) => {
    if (typeof value !== 'string') {
      return
    }
    const trimmed = value.trim()
    if (!trimmed || !Types.ObjectId.isValid(trimmed)) {
      return
    }
    const normalized = new Types.ObjectId(trimmed)
    const key = normalized.toString()
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    result.push(normalized)
  })
  return result
}

function normalizeCoverUrls(urls?: string[]): string[] {
  if (!Array.isArray(urls)) {
    return []
  }
  const seen = new Set<string>()
  const result: string[] = []
  urls.forEach((value) => {
    if (typeof value !== 'string') {
      return
    }
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) {
      return
    }
    seen.add(trimmed)
    result.push(trimmed)
  })
  return result
}

function mergeObjectIds(...inputs: Types.ObjectId[][]): Types.ObjectId[] {
  const seen = new Set<string>()
  const result: Types.ObjectId[] = []
  inputs.forEach((list) => {
    list.forEach((value) => {
      const key = value.toString()
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      result.push(new Types.ObjectId(key))
    })
  })
  return result
}

async function loadCollectionsByIds(collectionIds: Types.ObjectId[]): Promise<CollectionLean[]> {
  if (!collectionIds.length) {
    return []
  }
  const orderMap = new Map<string, number>()
  collectionIds.forEach((id, index) => orderMap.set(id.toString(), index))
  const collections = (await WorkCollectionModel.find({ _id: { $in: collectionIds } })
    .select(['title', 'description', 'coverUrl', 'workIds'])
    .lean()
    .exec()) as CollectionLean[]
  return collections.sort((a, b) => {
    const aOrder = orderMap.get(a._id.toString()) ?? 0
    const bOrder = orderMap.get(b._id.toString()) ?? 0
    return aOrder - bOrder
  })
}

function collectWorkIdsFromCollections(collections: CollectionLean[]): Types.ObjectId[] {
  const seen = new Set<string>()
  const result: Types.ObjectId[] = []
  collections.forEach((collection) => {
    collection.workIds?.forEach((workId) => {
      const key = workId.toString()
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      result.push(new Types.ObjectId(key))
    })
  })
  return result
}

function mapCollectionsToResponse(collections: CollectionLean[]): CollectionResponse[] {
  return collections.map((collection) => ({
    id: collection._id.toString(),
    title: collection.title,
    description: collection.description ?? undefined,
    coverUrl: collection.coverUrl ?? undefined,
    workCount: Array.isArray(collection.workIds) ? collection.workIds.length : 0,
  }))
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
  collections: CollectionResponse[],
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
  const coverUrls = (() => {
    const normalized = normalizeCoverUrls(exhibition.coverUrls ?? [])
    if (normalized.length) {
      return normalized
    }
    if (typeof exhibition.coverUrl === 'string') {
      const trimmed = exhibition.coverUrl.trim()
      return trimmed ? [trimmed] : []
    }
    return []
  })()
  const collectionIds = Array.isArray(exhibition.collectionIds)
    ? exhibition.collectionIds.map((id) => id.toString())
    : []
  return {
    ownerId: exhibition.ownerId.toString(),
    id: exhibition._id.toString(),
    name: exhibition.name,
    description: exhibition.description ?? undefined,
    coverUrl: coverUrls[0],
    coverUrls,
    status: exhibition.status,
    startDate: exhibition.startDate ? exhibition.startDate.toISOString() : undefined,
    endDate: exhibition.endDate ? exhibition.endDate.toISOString() : undefined,
    works,
    workCount: works.length,
    collections,
    collectionIds,
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
  return normalizeObjectIds(ids)
}

export async function createExhibition(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const body = ctx.request.body as ExhibitionInput
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    ctx.throw(400, 'Exhibition name is required')
  }
  const collectionIds = normalizeObjectIds(body.collectionIds)
  const collections = await loadCollectionsByIds(collectionIds)
  const validCollectionIds = collections.map((collection) => new Types.ObjectId(collection._id))
  const collectionWorkIds = collectWorkIdsFromCollections(collections)
  const explicitWorkIds = normalizeWorkIds(body.workIds)
  const workIds = mergeObjectIds(explicitWorkIds, collectionWorkIds)
  let coverUrls = normalizeCoverUrls(body.coverUrls)
  if (typeof body.coverUrl === 'string') {
    const trimmed = body.coverUrl.trim()
    if (trimmed && !coverUrls.includes(trimmed)) {
      coverUrls = [trimmed, ...coverUrls]
    }
  }
  const exhibition = await ExhibitionModel.create({
    ownerId: new Types.ObjectId(userId),
    name,
    description: body.description ?? '',
    coverUrl: coverUrls[0],
    coverUrls,
    startDate: parseDate(body.startDate),
    endDate: parseDate(body.endDate),
    workIds,
    collectionIds: validCollectionIds,
    status: body.status ?? 'published',
  })
  const works = await fetchWorkResponsesByIds(workIds, userId)
  ctx.status = 201
  ctx.body = buildExhibitionResponse(
    exhibition.toObject() as ExhibitionLean,
    works,
    mapCollectionsToResponse(collections),
    userId,
  )
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
  const data: ExhibitionResponse[] = await Promise.all(
    exhibitions.map(async (exhibition) => {
      const [works, collections] = await Promise.all([
        fetchWorkResponsesByIds(exhibition.workIds ?? [], userId),
        (async () => {
          const loaded = await loadCollectionsByIds(exhibition.collectionIds ?? [])
          return mapCollectionsToResponse(loaded)
        })(),
      ])
      return buildExhibitionResponse(exhibition, works, collections, userId)
    }),
  )
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
  const [works, collections] = await Promise.all([
    fetchWorkResponsesByIds(exhibition.workIds ?? [], userId),
    (async () => {
      const loaded = await loadCollectionsByIds(exhibition.collectionIds ?? [])
      return mapCollectionsToResponse(loaded)
    })(),
  ])
  ctx.body = buildExhibitionResponse(exhibition, works, collections, userId)
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
  let loadedCollections: CollectionLean[] | null = null
  if (typeof body.name === 'string' && body.name.trim()) {
    exhibition.name = body.name.trim()
  }
  if (typeof body.description === 'string') {
    exhibition.description = body.description
  }
  if (Array.isArray(body.coverUrls)) {
    exhibition.coverUrls = normalizeCoverUrls(body.coverUrls)
  }
  if (typeof body.coverUrl === 'string') {
    const trimmed = body.coverUrl.trim()
    if (trimmed) {
      exhibition.coverUrl = trimmed
      const current = normalizeCoverUrls(exhibition.coverUrls ?? [])
      exhibition.coverUrls = [trimmed, ...current.filter((url) => url !== trimmed)]
    }
  }
  if (!Array.isArray(body.coverUrls) && typeof body.coverUrl !== 'string') {
    const current = normalizeCoverUrls(exhibition.coverUrls ?? [])
    if (current.length) {
      exhibition.coverUrl = current[0]
      exhibition.coverUrls = current
    } else if (exhibition.coverUrl) {
      exhibition.coverUrls = [exhibition.coverUrl]
    }
  }
  if (typeof body.startDate === 'string') {
    const parsed = parseDate(body.startDate)
    exhibition.startDate = parsed ?? exhibition.startDate
  }
  if (typeof body.endDate === 'string') {
    const parsed = parseDate(body.endDate)
    exhibition.endDate = parsed ?? exhibition.endDate
  }
  if (Array.isArray(body.collectionIds)) {
    const nextCollectionIds = normalizeObjectIds(body.collectionIds)
    loadedCollections = await loadCollectionsByIds(nextCollectionIds)
    const validCollectionIds = loadedCollections.map((collection) => new Types.ObjectId(collection._id))
    exhibition.collectionIds = validCollectionIds
    const collectionWorkIds = collectWorkIdsFromCollections(loadedCollections)
    const baseWorkIds = Array.isArray(body.workIds)
      ? normalizeWorkIds(body.workIds)
      : (exhibition.workIds as Types.ObjectId[])
    exhibition.workIds = mergeObjectIds(baseWorkIds ?? [], collectionWorkIds)
  } else if (Array.isArray(body.workIds)) {
    exhibition.workIds = normalizeWorkIds(body.workIds)
  }
  if (body.status === 'draft' || body.status === 'published' || body.status === 'withdrawn') {
    exhibition.status = body.status
  }
  const normalizedCoverUrls = normalizeCoverUrls(exhibition.coverUrls ?? [])
  if (normalizedCoverUrls.length) {
    exhibition.coverUrls = normalizedCoverUrls
    exhibition.coverUrl = normalizedCoverUrls[0]
  } else if (exhibition.coverUrl) {
    exhibition.coverUrls = [exhibition.coverUrl]
  }
  await exhibition.save()
  const works = await fetchWorkResponsesByIds(exhibition.workIds ?? [], userId)
  if (!loadedCollections) {
    loadedCollections = await loadCollectionsByIds(exhibition.collectionIds ?? [])
  }
  ctx.body = buildExhibitionResponse(
    exhibition.toObject() as ExhibitionLean,
    works,
    mapCollectionsToResponse(loadedCollections),
    userId,
  )
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
  const [works, collections] = await Promise.all([
    fetchWorkResponsesByIds(exhibition.workIds ?? [], userId),
    (async () => {
      const loaded = await loadCollectionsByIds(exhibition.collectionIds ?? [])
      return mapCollectionsToResponse(loaded)
    })(),
  ])
  ctx.body = buildExhibitionResponse(exhibition, works, collections, userId)
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
  const collections = await loadCollectionsByIds(exhibition.collectionIds ?? [])
  ctx.body = buildExhibitionResponse(
    exhibition.toObject() as ExhibitionLean,
    works,
    mapCollectionsToResponse(collections),
    userId,
  )
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
