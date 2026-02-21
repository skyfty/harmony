import { Types } from 'mongoose'
import { AnalyticsEventModel } from '@/models/AnalyticsEvent'
import { AppUserModel } from '@/models/AppUser'
import { LoginAuditModel } from '@/models/LoginAudit'
import { SceneSpotModel } from '@/models/SceneSpot'

const VISIT_EVENT_TYPES = ['visit_exhibition', 'enter_scene', 'view_spot', 'page_view']

export type AnalyticsGranularity = 'day' | 'month' | 'week'

export interface TrackAnalyticsEventInput {
  eventType: string
  userId?: string
  sceneId?: string
  sceneSpotId?: string
  sessionId?: string
  source?: string
  device?: string
  path?: string
  dwellMs?: number
  metadata?: Record<string, unknown>
  occurredAt?: Date
}

export interface AnalyticsOverviewQuery {
  start?: string
  end?: string
  granularity?: string
  spotId?: string
}

function sanitizeLabel(value: unknown, fallback = '未知'): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : fallback
}

function toObjectId(value?: string): null | Types.ObjectId {
  if (!value || !Types.ObjectId.isValid(value)) {
    return null
  }
  return new Types.ObjectId(value)
}

function resolveDateRange(start?: string, end?: string): { endDate: Date; startDate: Date } {
  const endDate = end ? new Date(end) : new Date()
  const startDate = start ? new Date(start) : new Date(endDate.getTime() - 30 * 24 * 3600 * 1000)
  if (Number.isNaN(endDate.getTime()) || Number.isNaN(startDate.getTime())) {
    const fallbackEnd = new Date()
    return {
      endDate: fallbackEnd,
      startDate: new Date(fallbackEnd.getTime() - 30 * 24 * 3600 * 1000),
    }
  }
  return { endDate, startDate }
}

function normalizeGranularity(input?: string): AnalyticsGranularity {
  if (input === 'week' || input === 'month') {
    return input
  }
  return 'day'
}

function formatBucket(date: Date, granularity: AnalyticsGranularity): string {
  if (granularity === 'month') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  }
  if (granularity === 'week') {
    const firstDay = new Date(date)
    const day = firstDay.getDay() || 7
    firstDay.setDate(firstDay.getDate() - (day - 1))
    return `${firstDay.getFullYear()}-W${String(Math.ceil(firstDay.getDate() / 7)).padStart(2, '0')}`
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function buildBuckets(startDate: Date, endDate: Date, granularity: AnalyticsGranularity): string[] {
  const buckets: string[] = []
  const cursor = new Date(startDate)
  while (cursor <= endDate) {
    const key = formatBucket(cursor, granularity)
    if (!buckets.includes(key)) {
      buckets.push(key)
    }
    if (granularity === 'month') {
      cursor.setMonth(cursor.getMonth() + 1)
    } else if (granularity === 'week') {
      cursor.setDate(cursor.getDate() + 7)
    } else {
      cursor.setDate(cursor.getDate() + 1)
    }
  }
  return buckets
}

export function inferDeviceFromUserAgent(userAgent?: string): string {
  const ua = (userAgent ?? '').toLowerCase()
  if (!ua) {
    return 'unknown'
  }
  if (ua.includes('ipad') || ua.includes('tablet')) {
    return 'tablet'
  }
  if (ua.includes('android') || ua.includes('iphone') || ua.includes('mobile')) {
    return 'mobile'
  }
  if (ua.includes('windows') || ua.includes('macintosh') || ua.includes('linux')) {
    return 'desktop'
  }
  return 'other'
}

export async function recordAnalyticsEvent(input: TrackAnalyticsEventInput): Promise<void> {
  const payload = {
    eventType: sanitizeLabel(input.eventType),
    userId: toObjectId(input.userId),
    sceneId: toObjectId(input.sceneId),
    sceneSpotId: toObjectId(input.sceneSpotId),
    sessionId: sanitizeLabel(input.sessionId, ''),
    source: sanitizeLabel(input.source, 'direct'),
    device: sanitizeLabel(input.device, 'unknown'),
    path: sanitizeLabel(input.path, ''),
    dwellMs: typeof input.dwellMs === 'number' && Number.isFinite(input.dwellMs) && input.dwellMs > 0 ? input.dwellMs : 0,
    metadata: input.metadata ?? null,
    occurredAt: input.occurredAt ?? new Date(),
  }
  await AnalyticsEventModel.create(payload)
}

export async function getAnalyticsOverview(query: AnalyticsOverviewQuery) {
  const { startDate, endDate } = resolveDateRange(query.start, query.end)
  const granularity = normalizeGranularity(query.granularity)
  const spotObjectId = toObjectId(query.spotId)

  const eventBaseMatch: Record<string, unknown> = {
    occurredAt: { $gte: startDate, $lte: endDate },
  }
  if (spotObjectId) {
    eventBaseMatch.sceneSpotId = spotObjectId
  }

  const visitMatch: Record<string, unknown> = {
    ...eventBaseMatch,
    eventType: { $in: VISIT_EVENT_TYPES },
  }

  const [visitAgg, visitTrendRaw, sourceRaw, deviceRaw, pathRaw, dwellRaw, usersRaw, loginRaw, loginTrendRaw, topSpotsRaw] = await Promise.all([
    AnalyticsEventModel.aggregate<{ pv: number; users: Array<Types.ObjectId | null> }>([
      { $match: visitMatch },
      { $group: { _id: null, pv: { $sum: 1 }, users: { $addToSet: '$userId' } } },
    ]),
    AnalyticsEventModel.aggregate<{ _id: string; pv: number; users: Array<Types.ObjectId | null> }>([
      {
        $match: visitMatch,
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: granularity === 'month' ? '%Y-%m' : '%Y-%m-%d',
              date: '$occurredAt',
              timezone: 'Asia/Shanghai',
            },
          },
          pv: { $sum: 1 },
          users: { $addToSet: '$userId' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    AnalyticsEventModel.aggregate<{ _id: string; value: number }>([
      { $match: visitMatch },
      { $group: { _id: { $ifNull: ['$source', 'direct'] }, value: { $sum: 1 } } },
      { $sort: { value: -1 } },
      { $limit: 10 },
    ]),
    AnalyticsEventModel.aggregate<{ _id: string; value: number }>([
      { $match: visitMatch },
      { $group: { _id: { $ifNull: ['$device', 'unknown'] }, value: { $sum: 1 } } },
      { $sort: { value: -1 } },
      { $limit: 10 },
    ]),
    AnalyticsEventModel.aggregate<{ _id: string; value: number }>([
      { $match: { ...visitMatch, path: { $ne: '' } } },
      { $group: { _id: '$path', value: { $sum: 1 } } },
      { $sort: { value: -1 } },
      { $limit: 15 },
    ]),
    AnalyticsEventModel.aggregate<{ avgDwellMs: number }>([
      { $match: { ...visitMatch, dwellMs: { $gt: 0 } } },
      { $group: { _id: null, avgDwellMs: { $avg: '$dwellMs' } } },
    ]),
    AnalyticsEventModel.aggregate<{ _id: Types.ObjectId }>([
      { $match: { ...visitMatch, userId: { $ne: null } } },
      { $group: { _id: '$userId' } },
    ]),
    LoginAuditModel.aggregate<{ _id: boolean; count: number }>([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          action: 'login',
        },
      },
      {
        $group: {
          _id: '$success',
          count: { $sum: 1 },
        },
      },
    ]),
    LoginAuditModel.aggregate<{ _id: { date: string; success: boolean }; count: number }>([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          action: 'login',
        },
      },
      {
        $group: {
          _id: {
            date: {
              $dateToString: {
                format: granularity === 'month' ? '%Y-%m' : '%Y-%m-%d',
                date: '$createdAt',
                timezone: 'Asia/Shanghai',
              },
            },
            success: '$success',
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.date': 1 } },
    ]),
    AnalyticsEventModel.aggregate<{ _id: Types.ObjectId; pv: number; users: Array<Types.ObjectId | null> }>([
      { $match: { ...visitMatch, sceneSpotId: { $ne: null } } },
      { $group: { _id: '$sceneSpotId', pv: { $sum: 1 }, users: { $addToSet: '$userId' } } },
      { $sort: { pv: -1 } },
      { $limit: 10 },
    ]),
  ])

  const overview = visitAgg[0] ?? { pv: 0, users: [] }
  const overviewUv = overview.users.filter((user) => Boolean(user)).length

  const loginSuccess = loginRaw.find((row) => row._id === true)?.count ?? 0
  const loginFail = loginRaw.find((row) => row._id === false)?.count ?? 0

  const trendMap = new Map<string, { pv: number; uv: number }>()
  for (const row of visitTrendRaw) {
    trendMap.set(row._id, {
      pv: row.pv,
      uv: row.users.filter((user) => Boolean(user)).length,
    })
  }

  const trendBuckets = buildBuckets(startDate, endDate, granularity)
  const trend = trendBuckets.map((bucket) => {
    const row = trendMap.get(bucket)
    return {
      date: bucket,
      pv: row?.pv ?? 0,
      uv: row?.uv ?? 0,
    }
  })

  const loginTrendMap = new Map<string, { fail: number; success: number }>()
  for (const row of loginTrendRaw) {
    const key = row._id.date
    const current = loginTrendMap.get(key) ?? { fail: 0, success: 0 }
    if (row._id.success) {
      current.success = row.count
    } else {
      current.fail = row.count
    }
    loginTrendMap.set(key, current)
  }

  const loginTrend = trendBuckets.map((bucket) => {
    const row = loginTrendMap.get(bucket)
    return {
      date: bucket,
      success: row?.success ?? 0,
      fail: row?.fail ?? 0,
    }
  })

  const userIds = usersRaw
    .map((row) => row._id)
    .filter((value): value is Types.ObjectId => Boolean(value))

  const [genderRaw, ageRaw, interestRaw] = userIds.length
    ? await Promise.all([
      AppUserModel.aggregate<{ _id: string; value: number }>([
        { $match: { _id: { $in: userIds } } },
        { $group: { _id: { $ifNull: ['$gender', 'unknown'] }, value: { $sum: 1 } } },
        { $sort: { value: -1 } },
      ]),
      AppUserModel.aggregate<{ _id: string; value: number }>([
        { $match: { _id: { $in: userIds }, birthDate: { $ne: null } } },
        {
          $project: {
            age: {
              $floor: {
                $divide: [{ $subtract: [new Date(), '$birthDate'] }, 365 * 24 * 3600 * 1000],
              },
            },
          },
        },
        {
          $project: {
            ageRange: {
              $switch: {
                branches: [
                  { case: { $lt: ['$age', 18] }, then: '18岁以下' },
                  {
                    case: {
                      $and: [{ $gte: ['$age', 18] }, { $lte: ['$age', 24] }],
                    },
                    then: '18-24岁',
                  },
                  {
                    case: {
                      $and: [{ $gte: ['$age', 25] }, { $lte: ['$age', 34] }],
                    },
                    then: '25-34岁',
                  },
                  {
                    case: {
                      $and: [{ $gte: ['$age', 35] }, { $lte: ['$age', 44] }],
                    },
                    then: '35-44岁',
                  },
                  {
                    case: {
                      $and: [{ $gte: ['$age', 45] }, { $lte: ['$age', 54] }],
                    },
                    then: '45-54岁',
                  },
                ],
                default: '55岁以上',
              },
            },
          },
        },
        { $group: { _id: '$ageRange', value: { $sum: 1 } } },
        { $sort: { value: -1 } },
      ]),
      AppUserModel.aggregate<{ _id: string; value: number }>([
        { $match: { _id: { $in: userIds }, interests: { $type: 'array' } } as never },
        { $unwind: '$interests' },
        { $group: { _id: '$interests', value: { $sum: 1 } } },
        { $sort: { value: -1 } },
        { $limit: 15 },
      ]),
    ])
    : [[], [], []]

  const topSpotIds = topSpotsRaw
    .map((row) => row._id)
    .filter((value): value is Types.ObjectId => Boolean(value))
  const spots = topSpotIds.length
    ? await SceneSpotModel.find({ _id: { $in: topSpotIds } }).select({ title: 1 }).lean().exec()
    : []
  const spotTitleMap = new Map(spots.map((spot) => [String(spot._id), spot.title]))

  return {
    query: {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      granularity,
      spotId: query.spotId ?? null,
    },
    overview: {
      pv: overview.pv,
      uv: overviewUv,
      loginSuccess,
      loginFail,
      avgDwellMs: Math.round(dwellRaw[0]?.avgDwellMs ?? 0),
    },
    trend,
    loginTrend,
    sourceDistribution: sourceRaw.map((item) => ({ name: sanitizeLabel(item._id, 'direct'), value: item.value })),
    deviceDistribution: deviceRaw.map((item) => ({ name: sanitizeLabel(item._id, 'unknown'), value: item.value })),
    behaviorPaths: pathRaw.map((item) => ({ name: sanitizeLabel(item._id), value: item.value })),
    profile: {
      gender: genderRaw.map((item) => ({ name: sanitizeLabel(item._id), value: item.value })),
      age: ageRaw.map((item) => ({ name: sanitizeLabel(item._id), value: item.value })),
      interests: interestRaw.map((item) => ({ name: sanitizeLabel(item._id), value: item.value })),
    },
    topSpots: topSpotsRaw.map((item) => {
      const id = String(item._id)
      return {
        spotId: id,
        name: spotTitleMap.get(id) ?? id,
        pv: item.pv,
        uv: item.users.filter((user) => Boolean(user)).length,
      }
    }),
  }
}
