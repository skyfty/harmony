import { Types } from 'mongoose'
import { PunchRecordModel } from '@/models/PunchRecord'
import { SceneSpotModel } from '@/models/SceneSpot'
import { loadVehicleNameMapByIdentifier } from '@/services/vehicleLookupService'

export interface CreatePunchRecordInput {
  userId: string
  username?: string
  sceneId: string
  scenicId: string
  vehicleIdentifier?: string
  sceneName?: string
  nodeId: string
  nodeName?: string
  clientPunchTime?: string
  behaviorPunchTime?: string
  source?: string
  path?: string
  ip?: string
  userAgent?: string
  metadata?: Record<string, unknown>
}

export interface QueryPunchRecordsOptions {
  page?: number
  pageSize?: number
  sceneId?: string
  scenicId?: string
  vehicleIdentifier?: string
  sceneName?: string
  nodeId?: string
  nodeName?: string
  userId?: string
  username?: string
  start?: string
  end?: string
}

export interface PunchProgressBySceneInput {
  userId: string
  sceneId: string
  scenicId: string
}

export interface PunchProgressBySceneResult {
  sceneId: string
  scenicId: string
  checkedCount: number
  punchedNodeIds: string[]
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

export async function createPunchRecord(input: CreatePunchRecordInput): Promise<string> {
  if (!Types.ObjectId.isValid(input.userId)) {
    throw new Error('Invalid userId')
  }
  const userObjectId = new Types.ObjectId(input.userId)
  const sceneId = normalizeText(input.sceneId)
  const scenicId = normalizeText(input.scenicId)
  const vehicleIdentifier = normalizeText(input.vehicleIdentifier)
  const nodeId = normalizeText(input.nodeId)
  if (!sceneId) {
    throw new Error('sceneId is required')
  }
  if (!scenicId) {
    throw new Error('scenicId is required')
  }
  if (!nodeId) {
    throw new Error('nodeId is required')
  }

  const doc = await PunchRecordModel.findOneAndUpdate(
    {
      userId: userObjectId,
      scenicId,
      nodeId,
    },
    {
      $setOnInsert: {
        userId: userObjectId,
        username: normalizeText(input.username) || undefined,
        sceneId,
        scenicId,
        vehicleIdentifier: vehicleIdentifier || undefined,
        sceneName: normalizeText(input.sceneName) || undefined,
        nodeId,
        nodeName: normalizeText(input.nodeName) || undefined,
        clientPunchTime: parseDate(input.clientPunchTime) ?? undefined,
        behaviorPunchTime: parseDate(input.behaviorPunchTime) ?? undefined,
        source: normalizeText(input.source) || 'miniapp',
        path: normalizeText(input.path) || undefined,
        ip: normalizeText(input.ip) || undefined,
        userAgent: normalizeText(input.userAgent) || undefined,
        metadata: input.metadata ?? undefined,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  )

  if (!doc) {
    throw new Error('Failed to create punch record')
  }

  return doc._id.toString()
}

export async function queryPunchRecords(options: QueryPunchRecordsOptions) {
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

  const vehicleIdentifier = normalizeText(options.vehicleIdentifier)
  if (vehicleIdentifier) {
    filter.vehicleIdentifier = vehicleIdentifier
  }

  const sceneName = normalizeText(options.sceneName)
  if (sceneName) {
    filter.sceneName = new RegExp(sceneName, 'i')
  }

  const nodeId = normalizeText(options.nodeId)
  if (nodeId) {
    filter.nodeId = nodeId
  }

  const nodeName = normalizeText(options.nodeName)
  if (nodeName) {
    filter.nodeName = new RegExp(nodeName, 'i')
  }

  const username = normalizeText(options.username)
  if (username) {
    filter.username = new RegExp(username, 'i')
  }

  const userId = normalizeText(options.userId)
  if (userId && Types.ObjectId.isValid(userId)) {
    filter.userId = new Types.ObjectId(userId)
  }

  const start = parseDate(options.start)
  const end = parseDate(options.end)
  if (start || end) {
    filter.createdAt = {}
    if (start) {
      ;(filter.createdAt as Record<string, unknown>).$gte = start
    }
    if (end) {
      ;(filter.createdAt as Record<string, unknown>).$lte = end
    }
  }

  const [items, total] = await Promise.all([
    PunchRecordModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    PunchRecordModel.countDocuments(filter),
  ]) as [Array<Record<string, unknown>>, number]

  const scenicIds = Array.from(
    new Set(
      items
        .map((item: Record<string, unknown>) => normalizeText(item.scenicId))
        .filter((id: string) => Boolean(id) && Types.ObjectId.isValid(id)),
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
      const id = (row as { _id: Types.ObjectId })._id.toString()
      const title = normalizeText((row as { title?: string }).title)
      if (title) {
        scenicTitleMap.set(id, title)
      }
    }
  }

  const vehicleNameMap = await loadVehicleNameMapByIdentifier(
    items.map((item: Record<string, unknown>) => normalizeText(item.vehicleIdentifier)),
  )

  const enrichedItems = items.map((item: Record<string, unknown>) => {
    const scenicId = normalizeText(item.scenicId)
    const vehicleIdentifier = normalizeText(item.vehicleIdentifier)
    return {
      ...item,
      scenicTitle: scenicTitleMap.get(scenicId) || undefined,
      vehicleName: vehicleNameMap.get(vehicleIdentifier) || undefined,
    }
  })

  return {
    items: enrichedItems,
    total,
    page,
    pageSize,
  }
}

export async function getPunchProgressBySceneForUser(input: PunchProgressBySceneInput): Promise<PunchProgressBySceneResult> {
  const userId = normalizeText(input.userId)
  const sceneId = normalizeText(input.sceneId)
  const scenicId = normalizeText(input.scenicId)
  if (!Types.ObjectId.isValid(userId) || !sceneId || !scenicId) {
    return {
      sceneId,
      scenicId,
      checkedCount: 0,
      punchedNodeIds: [],
    }
  }

  const punchedNodeIds = (await PunchRecordModel.distinct('nodeId', {
    userId: new Types.ObjectId(userId),
    sceneId,
    scenicId,
  })) as string[]

  const uniqueNodeIds = Array.from(
    new Set(
      punchedNodeIds
        .map((nodeId: string) => normalizeText(nodeId))
        .filter((nodeId: string) => Boolean(nodeId)),
    ),
  ).sort((left: string, right: string) => left.localeCompare(right))

  return {
    sceneId,
    scenicId,
    checkedCount: uniqueNodeIds.length,
    punchedNodeIds: uniqueNodeIds,
  }
}

export async function getPunchRecordById(id: string) {
  if (!Types.ObjectId.isValid(id)) {
    return null
  }
  const item = await PunchRecordModel.findById(id).lean()
  if (!item) {
    return null
  }

  const vehicleIdentifier = normalizeText((item as { vehicleIdentifier?: string }).vehicleIdentifier)
  const vehicleNameMap = await loadVehicleNameMapByIdentifier(vehicleIdentifier ? [vehicleIdentifier] : [])

  return {
    ...item,
    vehicleName: vehicleNameMap.get(vehicleIdentifier) || undefined,
  }
}

export async function deletePunchRecordById(id: string) {
  if (!Types.ObjectId.isValid(id)) {
    return 0
  }
  const deleted = await PunchRecordModel.findByIdAndDelete(id).exec()
  return deleted ? 1 : 0
}
