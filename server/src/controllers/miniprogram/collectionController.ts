import type { Context } from 'koa'
import { Types } from 'mongoose'
import { WorkCollectionModel } from '@/models/WorkCollection'
import { WorkModel } from '@/models/Work'
import { ensureUserId } from './utils'
import { buildWorkResponse, type WorkLean, type WorkResponse } from './workHelpers'

interface CollectionInput {
  title?: string
  description?: string
  coverUrl?: string
  workIds?: string[]
  isPublic?: boolean
}

interface CollectionUpdateInput extends CollectionInput {
  appendWorkIds?: string[]
  removeWorkIds?: string[]
}

interface CollectionLean {
  _id: Types.ObjectId
  ownerId: Types.ObjectId
  title: string
  description?: string
  coverUrl?: string
  workIds: Types.ObjectId[]
  isPublic: boolean
  createdAt: Date
  updatedAt: Date
}

interface CollectionResponse {
  id: string
  title: string
  description?: string
  coverUrl?: string
  isPublic: boolean
  works: WorkResponse[]
  workCount: number
  createdAt: string
  updatedAt: string
}

function normalizeObjectIds(ids?: string[]): Types.ObjectId[] {
  if (!Array.isArray(ids)) {
    return []
  }
  return ids
    .filter((value) => Types.ObjectId.isValid(value))
    .map((value) => new Types.ObjectId(value))
}

function buildCollectionResponse(
  collection: CollectionLean,
  works: WorkResponse[],
): CollectionResponse {
  return {
    id: collection._id.toString(),
    title: collection.title,
    description: collection.description ?? undefined,
    coverUrl: collection.coverUrl ?? undefined,
    isPublic: collection.isPublic,
    works,
    workCount: works.length,
    createdAt: collection.createdAt.toISOString(),
    updatedAt: collection.updatedAt.toISOString(),
  }
}

async function resolveWorksForCollections(
  collections: CollectionLean[],
  userId?: string,
): Promise<Map<string, WorkResponse[]>> {
  const collectionMap = new Map<string, WorkResponse[]>()
  if (!collections.length) {
    return collectionMap
  }
  const allCollectionLean = new Map<string, { _id: Types.ObjectId; title: string; coverUrl?: string }>()
  const workIdSet = new Set<string>()
  collections.forEach((collection) => {
    allCollectionLean.set(collection._id.toString(), {
      _id: collection._id,
      title: collection.title,
      coverUrl: collection.coverUrl ?? undefined,
    })
    collection.workIds?.forEach((workId: Types.ObjectId) => {
      workIdSet.add(workId.toString())
    })
  })
  if (!workIdSet.size) {
    collections.forEach((collection) => {
      collectionMap.set(collection._id.toString(), [])
    })
    return collectionMap
  }
  const works = (await WorkModel.find({ _id: { $in: Array.from(workIdSet) } })
    .lean()
    .exec()) as WorkLean[]
  const workCache = new Map<string, WorkLean>()
  works.forEach((work) => {
    workCache.set(work._id.toString(), work)
  })
  const collectionLeanMap = new Map<string, { _id: Types.ObjectId; title: string; coverUrl?: string }>()
  allCollectionLean.forEach((value, key) => {
    collectionLeanMap.set(key, value)
  })
  collections.forEach((collection) => {
    const responses: WorkResponse[] = []
    collection.workIds?.forEach((id: Types.ObjectId) => {
      const work = workCache.get(id.toString())
      if (work) {
        responses.push(buildWorkResponse(work, userId, collectionLeanMap))
      }
    })
    collectionMap.set(collection._id.toString(), responses)
  })
  return collectionMap
}

export async function createCollection(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const body = ctx.request.body as CollectionInput
  const normalizedTitle = typeof body.title === 'string' ? body.title.trim() : ''
  if (!normalizedTitle) {
    ctx.throw(400, 'Collection title is required')
  }
  const workIds = normalizeObjectIds(body.workIds)
  const document = await WorkCollectionModel.create({
    ownerId: new Types.ObjectId(userId),
    title: normalizedTitle,
    description: body.description ?? '',
    coverUrl: body.coverUrl,
    isPublic: Boolean(body.isPublic),
    workIds,
  })
  if (workIds.length) {
    await WorkModel.updateMany(
      { _id: { $in: workIds }, ownerId: userId },
      { $addToSet: { collections: document._id } },
    ).exec()
  }
  const collection = document.toObject() as CollectionLean
  const workMap = await resolveWorksForCollections([collection], userId)
  const works = workMap.get(collection._id.toString()) ?? []
  ctx.status = 201
  ctx.body = buildCollectionResponse(collection, works)
}

export async function listCollections(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const collections = (await WorkCollectionModel.find({ ownerId: userId })
    .sort({ createdAt: -1 })
    .lean()
    .exec()) as CollectionLean[]
  const workMap = await resolveWorksForCollections(collections, userId)
  const data = collections.map((collection) => buildCollectionResponse(
    collection,
    workMap.get(collection._id.toString()) ?? [],
  ))
  ctx.body = {
    total: data.length,
    collections: data,
  }
}

export async function getCollection(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid collection id')
  }
  const collection = (await WorkCollectionModel.findOne({ _id: id, ownerId: userId })
    .lean()
    .exec()) as CollectionLean | null
  if (!collection) {
    ctx.throw(404, 'Collection not found')
    return
  }
  const workMap = await resolveWorksForCollections([collection], userId)
  const works = workMap.get(collection._id.toString()) ?? []
  ctx.body = buildCollectionResponse(collection, works)
}

export async function updateCollection(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid collection id')
  }
  const body = ctx.request.body as CollectionUpdateInput
  const collection = await WorkCollectionModel.findOne({ _id: id, ownerId: userId }).exec()
  if (!collection) {
    ctx.throw(404, 'Collection not found')
    return
  }
  if (typeof body.title === 'string' && body.title.trim()) {
    collection.title = body.title.trim()
  }
  if (typeof body.description === 'string') {
    collection.description = body.description
  }
  if (typeof body.coverUrl === 'string') {
    collection.coverUrl = body.coverUrl
  }
  if (typeof body.isPublic === 'boolean') {
    collection.isPublic = body.isPublic
  }
  const currentWorkIds = (collection.workIds ?? []).map((value: Types.ObjectId) => value.toString())
  let nextWorkIds = [...currentWorkIds]
  if (Array.isArray(body.workIds)) {
    nextWorkIds = normalizeObjectIds(body.workIds).map((value) => value.toString())
  } else {
    if (Array.isArray(body.appendWorkIds)) {
      body.appendWorkIds.forEach((value: string) => {
        if (Types.ObjectId.isValid(value) && !nextWorkIds.includes(value)) {
          nextWorkIds.push(value)
        }
      })
    }
    if (Array.isArray(body.removeWorkIds)) {
      nextWorkIds = nextWorkIds.filter((value: string) => !body.removeWorkIds?.includes(value))
    }
  }
  const nextWorkObjectIds = nextWorkIds.map((value: string) => new Types.ObjectId(value))
  const removedWorkIds = currentWorkIds.filter((value: string) => !nextWorkIds.includes(value))
  const addedWorkIds = nextWorkIds.filter((value: string) => !currentWorkIds.includes(value))
  collection.workIds = nextWorkObjectIds
  await collection.save()
  if (removedWorkIds.length) {
    await WorkModel.updateMany(
  { _id: { $in: removedWorkIds.map((value: string) => new Types.ObjectId(value)) } },
      { $pull: { collections: collection._id } },
    ).exec()
  }
  if (addedWorkIds.length) {
    await WorkModel.updateMany(
      { _id: { $in: addedWorkIds.map((value) => new Types.ObjectId(value)) } },
      { $addToSet: { collections: collection._id } },
    ).exec()
  }
  const leanCollection = collection.toObject() as CollectionLean
  const workMap = await resolveWorksForCollections([leanCollection], userId)
  const works = workMap.get(leanCollection._id.toString()) ?? []
  ctx.body = buildCollectionResponse(leanCollection, works)
}

export async function deleteCollection(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid collection id')
  }
  const collection = await WorkCollectionModel.findOneAndDelete({ _id: id, ownerId: userId }).lean().exec()
  if (!collection) {
    ctx.throw(404, 'Collection not found')
    return
  }
  if (Array.isArray(collection.workIds) && collection.workIds.length) {
    await WorkModel.updateMany(
      { _id: { $in: collection.workIds } },
      { $pull: { collections: new Types.ObjectId(id) } },
    ).exec()
  }
  ctx.body = { success: true }
}
