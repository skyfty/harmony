import type { Context } from 'koa'
import { Types } from 'mongoose'
import type { HydratedDocument } from 'mongoose'
import { WorkModel } from '@/models/Work'
import { UploadRecordModel } from '@/models/UploadRecord'
import type { WorkDocument } from '@/types/models'
import { WorkCollectionModel } from '@/models/WorkCollection'
import { ensureUserId } from './utils'
import {
  buildCollectionMap,
  buildWorkResponse,
  type WorkLean,
  type RatingLean,
} from './workHelpers'

interface WorkInput {
  title?: string
  description?: string
  mediaType?: 'image' | 'video' | 'model' | 'other'
  fileUrl?: string
  thumbnailUrl?: string
  size?: number
  tags?: string[]
  fileName?: string
}

function normalizeWorkInputs(input: unknown): WorkInput[] {
  if (!input) {
    return []
  }
  if (Array.isArray(input)) {
    return input as WorkInput[]
  }
  const typed = input as { works?: WorkInput[] } & WorkInput
  if (Array.isArray(typed.works)) {
    return typed.works
  }
  return [typed]
}

export async function createWorks(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const inputs = normalizeWorkInputs(ctx.request.body)
  const validInputs = inputs.filter((item) => typeof item.fileUrl === 'string')
  if (!validInputs.length) {
    ctx.throw(400, 'No valid works provided')
  }
  const now = new Date()
  const documents = validInputs.map((item: WorkInput) => ({
    ownerId: userId,
    title: item.title?.trim() || '未命名作品',
    description: item.description ?? '',
    mediaType: item.mediaType ?? 'image',
    fileUrl: item.fileUrl!,
    thumbnailUrl: item.thumbnailUrl ?? item.fileUrl,
    size: item.size,
    tags: item.tags ?? [],
    createdAt: now,
    updatedAt: now,
  }))
  const created: HydratedDocument<WorkDocument>[] = await WorkModel.insertMany(documents, { ordered: true })
  const uploadRecords = created.map((doc: HydratedDocument<WorkDocument>, index: number) => ({
    userId,
    workId: doc._id,
    fileName: validInputs[index]?.fileName ?? doc.title,
    fileUrl: doc.fileUrl,
    fileSize: validInputs[index]?.size ?? doc.size,
    mediaType: doc.mediaType,
    createdAt: doc.createdAt,
  }))
  await UploadRecordModel.insertMany(uploadRecords).catch(() => undefined)
  const collectionIds: Types.ObjectId[] = []
  created.forEach((doc: HydratedDocument<WorkDocument>) => {
    doc.collections?.forEach((collectionId: Types.ObjectId) => {
      collectionIds.push(collectionId as Types.ObjectId)
    })
  })
  const collectionMap = await buildCollectionMap(collectionIds)
  ctx.status = 201
  ctx.body = {
    works: created.map((doc: HydratedDocument<WorkDocument>) =>
      buildWorkResponse(doc.toObject() as WorkLean, userId, collectionMap),
    ),
  }
}

export async function listWorks(ctx: Context): Promise<void> {
  const userId = ctx.state.user?.id
  const { owner, collectionId, search } = ctx.query as Record<string, string | undefined>
  const filter: Record<string, unknown> = {}
  if (collectionId) {
    filter.collections = new Types.ObjectId(collectionId)
  }
  if (owner === 'me' && userId) {
    filter.ownerId = new Types.ObjectId(userId)
  } else if (owner) {
    filter.ownerId = new Types.ObjectId(owner)
  }
  if (search) {
    filter.$text = { $search: search }
  }
  const works = (await WorkModel.find(filter).sort({ createdAt: -1 }).lean().exec()) as WorkLean[]
  const collectionIds: Types.ObjectId[] = []
  works.forEach((work: WorkLean) => {
    work.collections?.forEach((collection: Types.ObjectId) => {
      collectionIds.push(collection)
    })
  })
  const collectionMap = await buildCollectionMap(collectionIds)
  ctx.body = {
    total: works.length,
    works: works.map((work: WorkLean) => buildWorkResponse(work, userId, collectionMap)),
  }
}

export async function getWork(ctx: Context): Promise<void> {
  const userId = ctx.state.user?.id
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid work id')
  }
  const work = (await WorkModel.findById(id).lean().exec()) as WorkLean | null
  if (!work) {
    ctx.throw(404, 'Work not found')
    return
  }
  const collectionMap = await buildCollectionMap(work.collections ?? [])
  ctx.body = buildWorkResponse(work, userId, collectionMap)
}

export async function removeWork(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid work id')
  }
  const work = await WorkModel.findOneAndDelete({ _id: id, ownerId: userId }).lean<WorkLean>().exec()
  if (!work) {
    ctx.throw(404, 'Work not found')
  }
  if (Array.isArray(work.collections) && work.collections.length) {
    await WorkCollectionModel.updateMany(
      { _id: { $in: work.collections } },
      { $pull: { workIds: new Types.ObjectId(id) } },
    ).exec()
  }
  await UploadRecordModel.deleteMany({ workId: id }).exec()
  ctx.body = { success: true }
}

export async function toggleWorkLike(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid work id')
  }
  const work = await WorkModel.findById(id).exec()
  if (!work) {
    ctx.throw(404, 'Work not found')
  }
  const alreadyLiked = work.likedBy.some((likedUserId: Types.ObjectId) => likedUserId.toString() === userId)
  if (alreadyLiked) {
    work.likedBy = work.likedBy.filter((likedUserId: Types.ObjectId) => likedUserId.toString() !== userId)
  } else {
    work.likedBy.push(new Types.ObjectId(userId))
  }
  await work.save()
  ctx.body = {
    liked: !alreadyLiked,
    likesCount: work.likedBy.length,
  }
}

export async function rateWork(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  const { score, comment } = ctx.request.body as { score?: number; comment?: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid work id')
  }
  if (typeof score !== 'number' || Number.isNaN(score) || score < 1 || score > 5) {
    ctx.throw(400, 'Score must be between 1 and 5')
  }
  const work = await WorkModel.findById(id).exec()
  if (!work) {
    ctx.throw(404, 'Work not found')
  }
  const now = new Date()
  const existingRating = work.ratings.find((rating: RatingLean) => rating.userId.toString() === userId)
  if (existingRating) {
    existingRating.score = score
    existingRating.comment = comment ?? existingRating.comment
    existingRating.updatedAt = now
  } else {
    work.ratings.push({
      userId: new Types.ObjectId(userId),
      score,
      comment,
      createdAt: now,
      updatedAt: now,
    })
  }
  await work.save()
  const collectionMap = await buildCollectionMap(work.collections ?? [])
  ctx.body = buildWorkResponse(work.toObject() as WorkLean, userId, collectionMap)
}
