import { Types } from 'mongoose'
import { PunchRecordModel } from '@/models/PunchRecord'

export interface CreatePunchRecordInput {
  userId: string
  username?: string
  sceneId: string
  scenicId: string
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
  sceneName?: string
  nodeId?: string
  nodeName?: string
  userId?: string
  username?: string
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

export async function createPunchRecord(input: CreatePunchRecordInput): Promise<string> {
  if (!Types.ObjectId.isValid(input.userId)) {
    throw new Error('Invalid userId')
  }
  const sceneId = normalizeText(input.sceneId)
  const scenicId = normalizeText(input.scenicId)
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

  const doc = await PunchRecordModel.create({
    userId: new Types.ObjectId(input.userId),
    username: normalizeText(input.username) || undefined,
    sceneId,
    scenicId,
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
  })
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
  ])

  return {
    items,
    total,
    page,
    pageSize,
  }
}

export async function getPunchRecordById(id: string) {
  if (!Types.ObjectId.isValid(id)) {
    return null
  }
  return await PunchRecordModel.findById(id).lean()
}

export async function deletePunchRecordById(id: string) {
  if (!Types.ObjectId.isValid(id)) {
    return 0
  }
  const deleted = await PunchRecordModel.findByIdAndDelete(id).exec()
  return deleted ? 1 : 0
}
