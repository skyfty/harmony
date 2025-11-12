import { Types } from 'mongoose'
import { WorkCollectionModel } from '@/models/WorkCollection'
import { WorkModel } from '@/models/Work'

export interface WorkLean {
  _id: Types.ObjectId
  ownerId: Types.ObjectId
  title: string
  description?: string
  mediaType: 'image' | 'video' | 'model' | 'other'
  fileUrl: string
  thumbnailUrl?: string
  size?: number
  tags?: string[]
  likedBy: Types.ObjectId[]
  ratings: Array<{
    userId: Types.ObjectId
    score: number
    comment?: string
    createdAt: Date
    updatedAt: Date
  }>
  collections: Types.ObjectId[]
  commentCount: number
  shareCount: number
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export type RatingLean = WorkLean['ratings'][number]

export interface CollectionLean {
  _id: Types.ObjectId
  title: string
  coverUrl?: string
}

export interface WorkResponse {
  id: string
  ownerId: string
  title: string
  description?: string
  mediaType: 'image' | 'video' | 'model' | 'other'
  fileUrl: string
  thumbnailUrl?: string
  size?: number
  tags: string[]
  likesCount: number
  liked: boolean
  averageRating: number
  ratingCount: number
  userRating?: {
    score: number
    comment?: string
  }
  collections: Array<{
    id: string
    title: string
    coverUrl?: string
  }>
  commentCount: number
  shareCount: number
  createdAt: string
  updatedAt: string
}

export async function buildCollectionMap(collectionIds: Types.ObjectId[]): Promise<Map<string, CollectionLean>> {
  if (!collectionIds.length) {
    return new Map()
  }
  const collections = (await WorkCollectionModel.find({ _id: { $in: collectionIds } })
    .select(['title', 'coverUrl'])
    .lean()
    .exec()) as Array<{ _id: Types.ObjectId; title: string; coverUrl?: string }>
  const map = new Map<string, CollectionLean>()
  collections.forEach((collection) => {
    map.set(collection._id.toString(), {
      _id: collection._id,
      title: collection.title,
      coverUrl: collection.coverUrl,
    })
  })
  return map
}

export function buildWorkResponse(work: WorkLean, userId?: string, collectionMap?: Map<string, CollectionLean>): WorkResponse {
  const liked = Boolean(userId && work.likedBy.some((id) => id.toString() === userId))
  const ratingCount = work.ratings.length
  const averageRating = ratingCount
    ? work.ratings.reduce((sum, rating) => sum + rating.score, 0) / ratingCount
    : 0
  const userRatingEntry = userId
    ? work.ratings.find((rating) => rating.userId.toString() === userId)
    : undefined
  const collections: WorkResponse['collections'] = []
  if (collectionMap) {
    work.collections.forEach((collectionId) => {
      const item = collectionMap.get(collectionId.toString())
      if (item) {
        collections.push({
          id: item._id.toString(),
          title: item.title,
          coverUrl: item.coverUrl ?? undefined,
        })
      }
    })
  }
  return {
    id: work._id.toString(),
    ownerId: work.ownerId.toString(),
    title: work.title,
    description: work.description ?? undefined,
    mediaType: work.mediaType,
    fileUrl: work.fileUrl,
    thumbnailUrl: work.thumbnailUrl ?? undefined,
    size: work.size ?? undefined,
    tags: Array.isArray(work.tags) ? work.tags : [],
    likesCount: work.likedBy.length,
    liked,
    averageRating: Number(averageRating.toFixed(2)),
    ratingCount,
    userRating: userRatingEntry
      ? {
          score: userRatingEntry.score,
          comment: userRatingEntry.comment ?? undefined,
        }
      : undefined,
    collections,
    commentCount: work.commentCount,
    shareCount: work.shareCount ?? 0,
    createdAt: work.createdAt.toISOString(),
    updatedAt: work.updatedAt.toISOString(),
  }
}

export async function fetchWorkResponsesByIds(workIds: Types.ObjectId[], userId?: string): Promise<WorkResponse[]> {
  if (!workIds.length) {
    return []
  }
  const orderMap = new Map<string, number>()
  const uniqueIds: Types.ObjectId[] = []
  const seen = new Set<string>()
  workIds.forEach((id, index) => {
    const key = id.toString()
    if (!orderMap.has(key)) {
      orderMap.set(key, index)
    }
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    uniqueIds.push(new Types.ObjectId(key))
  })
  const works = (await WorkModel.find({ _id: { $in: uniqueIds } })
    .lean()
    .exec()) as WorkLean[]
  if (!works.length) {
    return []
  }
  const collectionIds: Types.ObjectId[] = []
  works.forEach((work) => {
    work.collections?.forEach((collectionId) => {
      collectionIds.push(collectionId)
    })
  })
  const collectionMap = await buildCollectionMap(collectionIds)
  const sorted = works.sort((a, b) => {
    const aOrder = orderMap.get(a._id.toString()) ?? 0
    const bOrder = orderMap.get(b._id.toString()) ?? 0
    return aOrder - bOrder
  })
  return sorted.map((work) => buildWorkResponse(work, userId, collectionMap))
}
