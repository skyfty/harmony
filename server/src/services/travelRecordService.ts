import { Types } from 'mongoose'
import { SceneSpotModel } from '@/models/SceneSpot'
import { TravelRecordModel } from '@/models/TravelRecord'
import { PunchRecordModel } from '@/models/PunchRecord'

export interface CreateTravelEnterInput {
  userId: string
  username?: string
  sceneId: string
  sceneName?: string
  enterTime?: string
  source?: string
  path?: string
  ip?: string
  userAgent?: string
  metadata?: Record<string, unknown>
}

export interface CompleteTravelLeaveInput {
  userId: string
  sceneId: string
  leaveTime?: string
  source?: string
  path?: string
  metadata?: Record<string, unknown>
}

export interface QueryTravelRecordsOptions {
  page?: number
  pageSize?: number
  sceneId?: string
  sceneName?: string
  userId?: string
  username?: string
  status?: 'active' | 'completed'
  start?: string
  end?: string
}

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

function parseDate(value?: string): Date | null {
  if (!value || typeof value !== 'string') {
    return null
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date
}

function ensureObjectId(value: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw new Error('Invalid userId')
  }
  return new Types.ObjectId(value)
}

function toPositiveDurationSeconds(enterTime: Date, leaveTime: Date): number {
  const deltaMs = leaveTime.getTime() - enterTime.getTime()
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return 0
  }
  return Math.floor(deltaMs / 1000)
}

export async function createTravelEnterRecord(input: CreateTravelEnterInput): Promise<string> {
  const userObjectId = ensureObjectId(input.userId)
  const sceneId = normalizeText(input.sceneId)
  if (!sceneId) {
    throw new Error('sceneId is required')
  }

  const enterTime = parseDate(input.enterTime) ?? new Date()

  const doc = await TravelRecordModel.create({
    userId: userObjectId,
    username: normalizeText(input.username) || undefined,
    sceneId,
    sceneName: normalizeText(input.sceneName) || undefined,
    enterTime,
    status: 'active',
    source: normalizeText(input.source) || 'tour-miniapp',
    path: normalizeText(input.path) || undefined,
    ip: normalizeText(input.ip) || undefined,
    userAgent: normalizeText(input.userAgent) || undefined,
    metadata: input.metadata ?? undefined,
  })

  return doc._id.toString()
}

export async function completeTravelLeaveRecord(input: CompleteTravelLeaveInput): Promise<string | null> {
  const userObjectId = ensureObjectId(input.userId)
  const sceneId = normalizeText(input.sceneId)
  if (!sceneId) {
    throw new Error('sceneId is required')
  }

  const leaveTime = parseDate(input.leaveTime) ?? new Date()

  const activeRecord = await TravelRecordModel.findOne({
    userId: userObjectId,
    sceneId,
    status: 'active',
    leaveTime: null,
  })
    .sort({ enterTime: -1 })
    .exec()

  if (!activeRecord) {
    return null
  }

  activeRecord.leaveTime = leaveTime
  activeRecord.durationSeconds = toPositiveDurationSeconds(activeRecord.enterTime, leaveTime)
  activeRecord.status = 'completed'
  if (input.source !== undefined) {
    activeRecord.source = normalizeText(input.source) || activeRecord.source
  }
  if (input.path !== undefined) {
    activeRecord.path = normalizeText(input.path) || activeRecord.path
  }
  if (input.metadata !== undefined) {
    activeRecord.metadata = input.metadata
  }

  await activeRecord.save()
  return activeRecord._id.toString()
}

export async function queryTravelRecords(options: QueryTravelRecordsOptions) {
  const page = Math.max(1, Number(options.page ?? 1) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(options.pageSize ?? 20) || 20))
  const skip = (page - 1) * pageSize

  const filter: Record<string, unknown> = {}

  const sceneId = normalizeText(options.sceneId)
  if (sceneId) {
    filter.sceneId = sceneId
  }

  const sceneName = normalizeText(options.sceneName)
  if (sceneName) {
    filter.sceneName = new RegExp(sceneName, 'i')
  }

  const username = normalizeText(options.username)
  if (username) {
    filter.username = new RegExp(username, 'i')
  }

  const userId = normalizeText(options.userId)
  if (userId && Types.ObjectId.isValid(userId)) {
    filter.userId = new Types.ObjectId(userId)
  }

  if (options.status === 'active' || options.status === 'completed') {
    filter.status = options.status
  }

  const start = parseDate(options.start)
  const end = parseDate(options.end)
  if (start || end) {
    filter.enterTime = {}
    if (start) {
      ;(filter.enterTime as Record<string, unknown>).$gte = start
    }
    if (end) {
      ;(filter.enterTime as Record<string, unknown>).$lte = end
    }
  }

  const [items, total] = await Promise.all([
    TravelRecordModel.find(filter).sort({ enterTime: -1, createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    TravelRecordModel.countDocuments(filter),
  ])

  return {
    items,
    total,
    page,
    pageSize,
  }
}

export async function getTravelRecordById(id: string) {
  if (!Types.ObjectId.isValid(id)) {
    return null
  }
  return await TravelRecordModel.findById(id).lean()
}

export async function deleteTravelRecordById(id: string) {
  if (!Types.ObjectId.isValid(id)) {
    return 0
  }
  const deleted = await TravelRecordModel.findByIdAndDelete(id).exec()
  return deleted ? 1 : 0
}

export async function getTravelSummaryBySceneForUser(userId: string): Promise<Array<{ sceneId: string; sceneName?: string; visitedCount: number; totalDurationSeconds: number }>> {
  if (!Types.ObjectId.isValid(userId)) {
    return []
  }

  const rows = await TravelRecordModel.aggregate<{
    _id: string
    sceneName?: string
    visitedCount: number
    totalDurationSeconds: number
  }>([
    { $match: { userId: new Types.ObjectId(userId) } },
    {
      $group: {
        _id: '$sceneId',
        sceneName: { $last: '$sceneName' },
        visitedCount: { $sum: 1 },
        totalDurationSeconds: {
          $sum: {
            $cond: [{ $ifNull: ['$durationSeconds', false] }, '$durationSeconds', 0],
          },
        },
      },
    },
    { $sort: { visitedCount: -1, totalDurationSeconds: -1, _id: 1 } },
  ]).exec()

  return rows.map((row) => ({
    sceneId: row._id,
    sceneName: row.sceneName,
    visitedCount: row.visitedCount,
    totalDurationSeconds: row.totalDurationSeconds,
  }))
}

export async function getCheckinProgressBySceneForUser(userId: string): Promise<Array<{ sceneId: string; checkedCount: number; totalCount: number }>> {
  if (!Types.ObjectId.isValid(userId)) {
    return []
  }

  const records = await PunchRecordModel.find({ userId: new Types.ObjectId(userId) }, { sceneId: 1, nodeId: 1, metadata: 1 })
    .lean()
    .exec()

  const sceneToScenicIds = new Map<string, Set<string>>()

  for (const record of records) {
    const sceneId = normalizeText((record as { sceneId?: string }).sceneId)
    if (!sceneId) {
      continue
    }
    const nodeId = normalizeText((record as { nodeId?: string }).nodeId)
    const metadata = (record as { metadata?: Record<string, unknown> }).metadata
    const scenicIdFromMetadata = normalizeText(metadata?.scenicId)
    const scenicIdCandidate = scenicIdFromMetadata || nodeId
    if (!Types.ObjectId.isValid(scenicIdCandidate)) {
      continue
    }
    if (!sceneToScenicIds.has(sceneId)) {
      sceneToScenicIds.set(sceneId, new Set())
    }
    sceneToScenicIds.get(sceneId)?.add(scenicIdCandidate)
  }

  const sceneIds = Array.from(sceneToScenicIds.keys()).filter((sceneId) => Types.ObjectId.isValid(sceneId))
  if (!sceneIds.length) {
    return []
  }

  const totalRows = await SceneSpotModel.aggregate<{ _id: Types.ObjectId; totalCount: number }>([
    { $match: { sceneId: { $in: sceneIds.map((sceneId) => new Types.ObjectId(sceneId)) } } },
    { $group: { _id: '$sceneId', totalCount: { $sum: 1 } } },
  ]).exec()

  const totalMap = new Map<string, number>()
  for (const row of totalRows) {
    totalMap.set(row._id.toString(), row.totalCount)
  }

  return sceneIds.map((sceneId) => {
    const checkedCount = sceneToScenicIds.get(sceneId)?.size ?? 0
    const totalCount = totalMap.get(sceneId) ?? 0
    return {
      sceneId,
      checkedCount,
      totalCount,
    }
  })
}
