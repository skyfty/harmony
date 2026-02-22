import { Types } from 'mongoose'
import { SceneSpotModel } from '@/models/SceneSpot'
import { SceneModel } from '@/models/Scene'
import { TravelRecordModel } from '@/models/TravelRecord'
import { PunchRecordModel } from '@/models/PunchRecord'

export interface CreateTravelEnterInput {
  userId: string
  username?: string
  sceneId: string
  scenicId: string
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
  sceneId?: string
  scenicId: string
  leaveTime?: string
  source?: string
  path?: string
  metadata?: Record<string, unknown>
}

export interface QueryTravelRecordsOptions {
  page?: number
  pageSize?: number
  sceneId?: string
  scenicId?: string
  sceneName?: string
  userId?: string
  username?: string
  status?: 'active' | 'completed'
  start?: string
  end?: string
}

type AchievementCountRow = {
  _id: {
    userId: Types.ObjectId
    scenicId: string
  }
  count: number
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

function normalizeUserId(value: unknown): string {
  if (!value) {
    return ''
  }
  if (typeof value === 'string') {
    return value.trim()
  }
  if (value instanceof Types.ObjectId) {
    return value.toString()
  }
  if (typeof value === 'object' && typeof (value as { toString?: unknown }).toString === 'function') {
    return (value as { toString: () => string }).toString().trim()
  }
  return ''
}

function buildAchievementCountKey(userId: string, scenicId: string): string {
  return `${userId}::${scenicId}`
}

async function loadAchievementCountMap(
  pairs: Array<{ userId: string; scenicId: string }>,
): Promise<Map<string, number>> {
  const validPairs = pairs.filter((pair) => Types.ObjectId.isValid(pair.userId) && Types.ObjectId.isValid(pair.scenicId))
  if (!validPairs.length) {
    return new Map()
  }

  const userIds = Array.from(new Set(validPairs.map((pair) => pair.userId))).map((id) => new Types.ObjectId(id))
  const scenicIds = Array.from(new Set(validPairs.map((pair) => pair.scenicId)))

  const rows = await PunchRecordModel.aggregate<AchievementCountRow>([
    {
      $match: {
        userId: { $in: userIds },
        scenicId: { $in: scenicIds },
      },
    },
    {
      $group: {
        _id: {
          userId: '$userId',
          scenicId: '$scenicId',
          nodeId: '$nodeId',
        },
      },
    },
    {
      $group: {
        _id: {
          userId: '$_id.userId',
          scenicId: '$_id.scenicId',
        },
        count: { $sum: 1 },
      },
    },
  ]).exec()

  const map = new Map<string, number>()
  for (const row of rows) {
    const userId = row._id.userId.toString()
    const scenicId = normalizeText(row._id.scenicId)
    if (!userId || !scenicId) {
      continue
    }
    map.set(buildAchievementCountKey(userId, scenicId), row.count)
  }

  return map
}

export async function createTravelEnterRecord(input: CreateTravelEnterInput): Promise<string> {
  const userObjectId = ensureObjectId(input.userId)
  const sceneId = normalizeText(input.sceneId)
  const scenicId = normalizeText(input.scenicId)
  if (!sceneId) {
    throw new Error('sceneId is required')
  }
  if (!scenicId) {
    throw new Error('scenicId is required')
  }

  const enterTime = parseDate(input.enterTime) ?? new Date()

  const updateSet: Record<string, unknown> = {
    sceneId,
    enterTime,
    leaveTime: null,
    durationSeconds: null,
    status: 'active',
    source: normalizeText(input.source) || 'tour-miniapp',
  }
  const updateUnset: Record<string, ''> = {}

  if (input.username !== undefined) {
    const username = normalizeText(input.username)
    if (username) {
      updateSet.username = username
    } else {
      updateUnset.username = ''
    }
  }

  if (input.sceneName !== undefined) {
    const sceneName = normalizeText(input.sceneName)
    if (sceneName) {
      updateSet.sceneName = sceneName
    } else {
      updateUnset.sceneName = ''
    }
  }

  if (input.path !== undefined) {
    const path = normalizeText(input.path)
    if (path) {
      updateSet.path = path
    } else {
      updateUnset.path = ''
    }
  }

  if (input.ip !== undefined) {
    const ip = normalizeText(input.ip)
    if (ip) {
      updateSet.ip = ip
    } else {
      updateUnset.ip = ''
    }
  }

  if (input.userAgent !== undefined) {
    const userAgent = normalizeText(input.userAgent)
    if (userAgent) {
      updateSet.userAgent = userAgent
    } else {
      updateUnset.userAgent = ''
    }
  }

  if (input.metadata !== undefined) {
    updateSet.metadata = input.metadata ?? null
  }

  const updateDoc: {
    $set: Record<string, unknown>
    $setOnInsert: Record<string, unknown>
    $unset?: Record<string, ''>
  } = {
    $set: updateSet,
    $setOnInsert: {
      userId: userObjectId,
      scenicId,
    },
  }

  if (Object.keys(updateUnset).length) {
    updateDoc.$unset = updateUnset
  }

  const doc = await TravelRecordModel.findOneAndUpdate(
    {
      userId: userObjectId,
      scenicId,
    },
    updateDoc,
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  )
    .sort({ updatedAt: -1, enterTime: -1, createdAt: -1 })
    .exec()

  return doc._id.toString()
}

export async function completeTravelLeaveRecord(input: CompleteTravelLeaveInput): Promise<string | null> {
  const userObjectId = ensureObjectId(input.userId)
  const scenicId = normalizeText(input.scenicId)
  if (!scenicId) {
    throw new Error('scenicId is required')
  }

  const leaveTime = parseDate(input.leaveTime) ?? new Date()

  const activeRecord = await TravelRecordModel.findOne({
    userId: userObjectId,
    scenicId,
    status: 'active',
    leaveTime: null,
  })
    .sort({ enterTime: -1, updatedAt: -1, createdAt: -1 })
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

  const scenicId = normalizeText(options.scenicId)
  if (scenicId) {
    filter.scenicId = scenicId
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

  const [result] = await TravelRecordModel.aggregate<{
    items: Array<Record<string, unknown>>
    totalRows: Array<{ total: number }>
  }>([
    { $sort: { enterTime: -1, updatedAt: -1, createdAt: -1, _id: -1 } },
    {
      $group: {
        _id: {
          userId: '$userId',
          scenicId: '$scenicId',
        },
        doc: { $first: '$$ROOT' },
      },
    },
    { $replaceRoot: { newRoot: '$doc' } },
    { $match: filter },
    {
      $facet: {
        items: [{ $sort: { enterTime: -1, createdAt: -1, _id: -1 } }, { $skip: skip }, { $limit: pageSize }],
        totalRows: [{ $count: 'total' }],
      },
    },
  ]).exec()

  const items = result?.items ?? []
  const total = result?.totalRows?.[0]?.total ?? 0

  const sceneIds = Array.from(
    new Set(
      items
        .map((item) => normalizeText((item as { sceneId?: string }).sceneId))
        .filter((id) => Boolean(id) && Types.ObjectId.isValid(id)),
    ),
  )

  const sceneNameMap = new Map<string, string>()
  const sceneCheckpointTotalMap = new Map<string, number>()
  if (sceneIds.length) {
    const sceneRows = await SceneModel.find(
      { _id: { $in: sceneIds.map((id) => new Types.ObjectId(id)) } },
      { _id: 1, name: 1, checkpointTotal: 1 },
    )
      .lean()
      .exec()

    for (const row of sceneRows) {
      const id = (row as { _id: Types.ObjectId })._id.toString()
      const name = normalizeText((row as { name?: string }).name)
      if (name) {
        sceneNameMap.set(id, name)
      }
      const rawCheckpointTotal = Number((row as { checkpointTotal?: unknown }).checkpointTotal)
      sceneCheckpointTotalMap.set(id, Number.isFinite(rawCheckpointTotal) && rawCheckpointTotal > 0 ? Math.floor(rawCheckpointTotal) : 0)
    }
  }

  const scenicIds = Array.from(
    new Set(
      items
        .map((item) => normalizeText((item as { scenicId?: string }).scenicId))
        .filter((id) => Boolean(id) && Types.ObjectId.isValid(id)),
    ),
  )

  const scenicTitleMap = new Map<string, string>()
  if (scenicIds.length) {
    const scenicRows = await SceneSpotModel.find(
      { _id: { $in: scenicIds.map((id) => new Types.ObjectId(id)) } },
      { _id: 1, title: 1 },
    )
      .lean()
      .exec()

    for (const row of scenicRows) {
      const scenicId = (row as { _id: Types.ObjectId })._id.toString()
      const scenicTitle = normalizeText((row as { title?: string }).title)
      if (scenicTitle) {
        scenicTitleMap.set(scenicId, scenicTitle)
      }
    }
  }

  const achievementCountMap = await loadAchievementCountMap(
    items.map((item) => ({
      userId: normalizeUserId((item as { userId?: unknown }).userId),
      scenicId: normalizeText((item as { scenicId?: string }).scenicId),
    })),
  )

  const enrichedItems = items.map((item) => {
    const sceneId = normalizeText((item as { sceneId?: string }).sceneId)
    const sceneName = normalizeText((item as { sceneName?: string }).sceneName)
    const scenicId = normalizeText((item as { scenicId?: string }).scenicId)
    const userId = normalizeUserId((item as { userId?: unknown }).userId)
    const achievementCount = userId && scenicId ? achievementCountMap.get(buildAchievementCountKey(userId, scenicId)) ?? 0 : 0
    return {
      ...item,
      sceneName: sceneName || sceneNameMap.get(sceneId) || undefined,
      sceneCheckpointTotal: sceneCheckpointTotalMap.get(sceneId) ?? 0,
      scenicTitle: scenicTitleMap.get(scenicId) || undefined,
      achievementCount,
    }
  })

  return {
    items: enrichedItems,
    total,
    page,
    pageSize,
  }
}

export async function getTravelRecordById(id: string) {
  if (!Types.ObjectId.isValid(id)) {
    return null
  }
  const item = await TravelRecordModel.findById(id).lean()
  if (!item) {
    return null
  }

  const userId = normalizeUserId((item as { userId?: unknown }).userId)
  const scenicId = normalizeText((item as { scenicId?: string }).scenicId)
  let achievementCount = 0
  if (Types.ObjectId.isValid(userId) && Types.ObjectId.isValid(scenicId)) {
    const distinctNodes = await PunchRecordModel.distinct('nodeId', {
      userId: new Types.ObjectId(userId),
      scenicId,
    }).exec()
    achievementCount = distinctNodes.length
  }

  const sceneId = normalizeText((item as { sceneId?: string }).sceneId)
  let sceneCheckpointTotal = 0
  if (Types.ObjectId.isValid(sceneId)) {
    const scene = await SceneModel.findById(sceneId, { checkpointTotal: 1 }).lean().exec()
    const rawCheckpointTotal = Number((scene as { checkpointTotal?: unknown } | null)?.checkpointTotal)
    sceneCheckpointTotal = Number.isFinite(rawCheckpointTotal) && rawCheckpointTotal > 0 ? Math.floor(rawCheckpointTotal) : 0
  }

  return {
    ...item,
    sceneCheckpointTotal,
    achievementCount,
  }
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
    { $sort: { enterTime: -1, updatedAt: -1, createdAt: -1, _id: -1 } },
    {
      $group: {
        _id: {
          sceneId: '$sceneId',
          scenicId: '$scenicId',
        },
        doc: { $first: '$$ROOT' },
      },
    },
    { $replaceRoot: { newRoot: '$doc' } },
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

  const records = await PunchRecordModel.find({ userId: new Types.ObjectId(userId) }, { sceneId: 1, scenicId: 1, nodeId: 1 })
    .lean()
    .exec()

  const sceneToAchievementNodes = new Map<string, Set<string>>()

  for (const record of records) {
    const sceneId = normalizeText((record as { sceneId?: string }).sceneId)
    if (!sceneId) {
      continue
    }
    const scenicIdCandidate = normalizeText((record as { scenicId?: string }).scenicId)
    const nodeId = normalizeText((record as { nodeId?: string }).nodeId)
    if (!Types.ObjectId.isValid(scenicIdCandidate)) {
      continue
    }
    if (!nodeId) {
      continue
    }
    if (!sceneToAchievementNodes.has(sceneId)) {
      sceneToAchievementNodes.set(sceneId, new Set())
    }
    sceneToAchievementNodes.get(sceneId)?.add(`${scenicIdCandidate}::${nodeId}`)
  }

  const sceneIds = Array.from(sceneToAchievementNodes.keys()).filter((sceneId) => Types.ObjectId.isValid(sceneId))
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
    const checkedCount = sceneToAchievementNodes.get(sceneId)?.size ?? 0
    const totalCount = totalMap.get(sceneId) ?? 0
    return {
      sceneId,
      checkedCount,
      totalCount,
    }
  })
}

export async function getCheckinProgressByScenicForUser(userId: string): Promise<Array<{
  scenicId: string
  sceneId: string
  scenicTitle: string
  coverImage: string
  slides: string[]
  checkedCount: number
  totalCount: number
  ratio: number
}>> {
  if (!Types.ObjectId.isValid(userId)) {
    return []
  }

  const records = await PunchRecordModel.find({ userId: new Types.ObjectId(userId) }, { scenicId: 1, nodeId: 1 })
    .lean()
    .exec()

  const scenicToNodeSet = new Map<string, Set<string>>()
  for (const record of records) {
    const scenicId = normalizeText((record as { scenicId?: string }).scenicId)
    const nodeId = normalizeText((record as { nodeId?: string }).nodeId)
    if (!Types.ObjectId.isValid(scenicId) || !nodeId) {
      continue
    }
    if (!scenicToNodeSet.has(scenicId)) {
      scenicToNodeSet.set(scenicId, new Set())
    }
    scenicToNodeSet.get(scenicId)?.add(nodeId)
  }

  const scenicIds = Array.from(scenicToNodeSet.keys())
  if (!scenicIds.length) {
    return []
  }

  const spots = await SceneSpotModel.find(
    { _id: { $in: scenicIds.map((scenicId) => new Types.ObjectId(scenicId)) } },
    { _id: 1, sceneId: 1, title: 1, coverImage: 1, slides: 1 },
  )
    .lean()
    .exec()

  const spotMap = new Map<string, (typeof spots)[number]>()
  const sceneIds = new Set<string>()
  for (const spot of spots) {
    spotMap.set(String(spot._id), spot)
    const sceneId = String((spot as { sceneId?: unknown }).sceneId ?? '')
    if (Types.ObjectId.isValid(sceneId)) {
      sceneIds.add(sceneId)
    }
  }

  const sceneCheckpointTotalMap = new Map<string, number>()
  if (sceneIds.size) {
    const sceneRows = await SceneModel.find(
      { _id: { $in: Array.from(sceneIds).map((sceneId) => new Types.ObjectId(sceneId)) } },
      { _id: 1, checkpointTotal: 1 },
    )
      .lean()
      .exec()

    for (const scene of sceneRows) {
      const sceneId = String((scene as { _id?: unknown })._id ?? '')
      const rawCheckpointTotal = Number((scene as { checkpointTotal?: unknown }).checkpointTotal)
      sceneCheckpointTotalMap.set(sceneId, Number.isFinite(rawCheckpointTotal) && rawCheckpointTotal > 0 ? Math.floor(rawCheckpointTotal) : 0)
    }
  }

  const result: Array<{
    scenicId: string
    sceneId: string
    scenicTitle: string
    coverImage: string
    slides: string[]
    checkedCount: number
    totalCount: number
    ratio: number
  }> = []

  for (const scenicId of scenicIds) {
    const spot = spotMap.get(scenicId)
    if (!spot) {
      continue
    }
    const checkedCount = scenicToNodeSet.get(scenicId)?.size ?? 0
    const sceneId = String((spot as { sceneId?: unknown }).sceneId ?? '')
    const totalCount = sceneCheckpointTotalMap.get(sceneId) ?? 0

    result.push({
      scenicId,
      sceneId,
      scenicTitle: normalizeText((spot as { title?: string }).title),
      coverImage: normalizeText((spot as { coverImage?: string | null }).coverImage ?? ''),
      slides: Array.isArray((spot as { slides?: unknown[] }).slides)
        ? ((spot as { slides?: unknown[] }).slides ?? []).map((item) => String(item)).filter(Boolean)
        : [],
      checkedCount,
      totalCount,
      ratio: totalCount > 0 ? checkedCount / totalCount : 0,
    })
  }

  result.sort((a, b) => {
    if (b.ratio !== a.ratio) {
      return b.ratio - a.ratio
    }
    if (b.checkedCount !== a.checkedCount) {
      return b.checkedCount - a.checkedCount
    }
    return a.scenicTitle.localeCompare(b.scenicTitle)
  })

  return result
}
