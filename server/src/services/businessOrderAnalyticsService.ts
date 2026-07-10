import { Types } from 'mongoose'
import { AnalyticsEventModel } from '@/models/AnalyticsEvent'
import { PunchRecordModel } from '@/models/PunchRecord'

const VISIT_EVENT_TYPES = ['visit_exhibition', 'enter_scene', 'view_spot', 'page_view']

export interface BusinessOrderAnalyticsQuery {
  end?: string
  sceneId: string
  sceneSpotId?: string | null
  start?: string
}

export interface BusinessOrderAnalyticsResponse {
  checkpointStats: Array<{
    nodeId: string
    nodeName: string
    punchCount: number
    userCount: number
  }>
  overview: {
    todayNewUsers: number
    todayUv: number
    totalPunchCount: number
    totalUv: number
  }
  query: {
    end: string
    sceneId: string
    sceneSpotId: string | null
    start: string
  }
  visitTrend: Array<{
    date: string
    newUsers: number
    pv: number
    uv: number
  }>
}

function parseDate(value?: string): Date | null {
  if (!value) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeDateRange(start?: string, end?: string): { endDate: Date; startDate: Date } {
  const endDate = parseDate(end) ?? new Date()
  const startDate = parseDate(start) ?? new Date(endDate.getTime() - 29 * 24 * 60 * 60 * 1000)
  return { endDate, startDate }
}

function formatDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function buildDayBuckets(startDate: Date, endDate: Date): string[] {
  const buckets: string[] = []
  const cursor = new Date(startDate)
  cursor.setHours(0, 0, 0, 0)
  const endCursor = new Date(endDate)
  endCursor.setHours(23, 59, 59, 999)
  while (cursor <= endCursor) {
    buckets.push(formatDay(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return buckets
}

export async function getBusinessOrderAnalytics(query: BusinessOrderAnalyticsQuery): Promise<BusinessOrderAnalyticsResponse> {
  if (!Types.ObjectId.isValid(query.sceneId)) {
    throw new Error('Invalid scene id')
  }

  const { startDate, endDate } = normalizeDateRange(query.start, query.end)
  const startBucket = new Date(startDate)
  startBucket.setHours(0, 0, 0, 0)
  const endBucket = new Date(endDate)
  endBucket.setHours(23, 59, 59, 999)
  const sceneObjectId = new Types.ObjectId(query.sceneId)
  const sceneSpotObjectId = query.sceneSpotId && Types.ObjectId.isValid(query.sceneSpotId)
    ? new Types.ObjectId(query.sceneSpotId)
    : null

  const visitMatch: Record<string, unknown> = {
    occurredAt: { $gte: startBucket, $lte: endBucket },
    eventType: { $in: VISIT_EVENT_TYPES },
    sceneId: sceneObjectId,
  }
  if (sceneSpotObjectId) {
    visitMatch.sceneSpotId = sceneSpotObjectId
  }

  const punchMatch: Record<string, unknown> = {
    createdAt: { $gte: startBucket, $lte: endBucket },
    sceneId: query.sceneId,
  }

  const [visitAgg, trendRaw, firstVisitRaw, totalPunchCount, checkpointStatsRaw] = await Promise.all([
    AnalyticsEventModel.aggregate<{ pv: number; users: Array<Types.ObjectId | null> }>([
      { $match: visitMatch },
      {
        $group: {
          _id: null,
          pv: { $sum: 1 },
          users: { $addToSet: '$userId' },
        },
      },
    ]),
    AnalyticsEventModel.aggregate<{ _id: string; pv: number; users: Array<Types.ObjectId | null> }>([
      { $match: visitMatch },
      {
        $group: {
          _id: {
            $dateToString: {
              date: '$occurredAt',
              format: '%Y-%m-%d',
              timezone: 'Asia/Shanghai',
            },
          },
          pv: { $sum: 1 },
          users: { $addToSet: '$userId' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    AnalyticsEventModel.aggregate<{ _id: string; users: Array<Types.ObjectId | null> }>([
      { $match: { ...visitMatch, userId: { $ne: null } } },
      { $sort: { occurredAt: 1 } },
      {
        $group: {
          _id: '$userId',
          firstVisitAt: { $first: '$occurredAt' },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              date: '$firstVisitAt',
              format: '%Y-%m-%d',
              timezone: 'Asia/Shanghai',
            },
          },
          users: { $push: '$_id' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    PunchRecordModel.countDocuments(punchMatch),
    PunchRecordModel.aggregate<{ _id: { nodeId: string; nodeName: string }; total: number; users: Array<Types.ObjectId | null> }>([
      { $match: punchMatch },
      {
        $group: {
          _id: {
            nodeId: { $ifNull: ['$nodeId', ''] },
            nodeName: { $ifNull: ['$nodeName', '未命名打卡点'] },
          },
          total: { $sum: 1 },
          users: { $addToSet: '$userId' },
        },
      },
      { $sort: { total: -1, '_id.nodeName': 1 } },
      { $limit: 30 },
    ]),
  ])

  const overview = visitAgg[0] ?? { pv: 0, users: [] }
  const totalUv = overview.users.filter((user) => Boolean(user)).length
  const buckets = buildDayBuckets(startBucket, endBucket)
  const todayKey = formatDay(endBucket)

  const trendMap = new Map(trendRaw.map((row) => [row._id, row]))
  const newUserMap = new Map(firstVisitRaw.map((row) => [row._id, row.users.filter((item) => Boolean(item)).length]))
  const visitTrend = buckets.map((date) => {
    const row = trendMap.get(date)
    return {
      date,
      pv: row?.pv ?? 0,
      uv: row?.users.filter((user) => Boolean(user)).length ?? 0,
      newUsers: newUserMap.get(date) ?? 0,
    }
  })
  const todayTrend = visitTrend.find((item) => item.date === todayKey) ?? { date: todayKey, pv: 0, uv: 0, newUsers: 0 }

  return {
    overview: {
      totalUv,
      todayUv: todayTrend.uv,
      todayNewUsers: todayTrend.newUsers,
      totalPunchCount,
    },
    visitTrend,
    checkpointStats: checkpointStatsRaw.map((row) => ({
      nodeId: row._id.nodeId || '',
      nodeName: row._id.nodeName || '未命名打卡点',
      punchCount: row.total,
      userCount: row.users.filter((item) => Boolean(item)).length,
    })),
    query: {
      start: startBucket.toISOString(),
      end: endBucket.toISOString(),
      sceneId: query.sceneId,
      sceneSpotId: query.sceneSpotId ?? null,
    },
  }
}

