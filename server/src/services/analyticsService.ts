import { Types } from 'mongoose'
import { AnalyticsEventModel } from '@/models/AnalyticsEvent'
import { BusinessOrderModel } from '@/models/BusinessOrder'
import { AppUserModel } from '@/models/AppUser'
import { OrderModel } from '@/models/Order'
import { PunchRecordModel } from '@/models/PunchRecord'
import { LoginAuditModel } from '@/models/LoginAudit'
import { TravelRecordModel } from '@/models/TravelRecord'
import { UserVehicleModel } from '@/models/UserVehicle'
import { VehicleModel } from '@/models/Vehicle'
import { SceneSpotModel } from '@/models/SceneSpot'

const VISIT_EVENT_TYPES = ['visit_exhibition', 'enter_scene', 'view_spot', 'page_view']

export type AnalyticsGranularity = 'day' | 'month' | 'week'
export type AnalyticsDomainKey = 'orders' | 'punch' | 'travel' | 'users' | 'vehicles'

export interface AnalyticsSummaryQuery {
  start?: string
  end?: string
  granularity?: string
  spotId?: string
}

export interface AnalyticsDomainQuery extends AnalyticsSummaryQuery {
  limit?: number
}

export interface AnalyticsMetricItem {
  name: string
  value: number
}

export interface AnalyticsTrendItem {
  date: string
  value: number
  secondaryValue?: number
}

export interface AnalyticsRecentItem {
  id: string
  title: string
  subtitle?: string
  value?: number | string | null
  status?: string | null
  createdAt?: string | null
  metadata?: Record<string, unknown>
}

export interface AnalyticsDomainSummary {
  key: AnalyticsDomainKey
  title: string
  summary: AnalyticsMetricItem[]
  trend: AnalyticsTrendItem[]
  breakdown: AnalyticsMetricItem[]
  recent: AnalyticsRecentItem[]
}

export interface AnalyticsDashboardResponse {
  query: {
    start: string
    end: string
    granularity: AnalyticsGranularity
    spotId: null | string
  }
  overview: {
    pv: number
    uv: number
    loginSuccess: number
    loginFail: number
    avgDwellMs: number
  }
  trend: { date: string; pv: number; uv: number }[]
  loginTrend: { date: string; success: number; fail: number }[]
  sourceDistribution: AnalyticsMetricItem[]
  deviceDistribution: AnalyticsMetricItem[]
  behaviorPaths: AnalyticsMetricItem[]
  profile: {
    gender: AnalyticsMetricItem[]
    age: AnalyticsMetricItem[]
    interests: AnalyticsMetricItem[]
  }
  topSpots: { spotId: string; name: string; pv: number; uv: number }[]
  domains: Record<AnalyticsDomainKey, AnalyticsDomainSummary>
}

export interface TrackAnalyticsEventInput {
  eventType: string
  userId?: string
  sceneId?: string
  sceneSpotId?: string
  vehicleIdentifier?: string
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

function parseDate(value?: string): Date | null {
  if (!value) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeDateRange(start?: string, end?: string): { endDate: Date; startDate: Date } {
  const endDate = parseDate(end) ?? new Date()
  const startDate = parseDate(start) ?? new Date(endDate.getTime() - 30 * 24 * 3600 * 1000)
  return { endDate, startDate }
}

function getTimeBucketRange(startDate: Date, endDate: Date, granularity: AnalyticsGranularity): string[] {
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

function formatDateTime(value?: Date | string | null): string | null {
  if (!value) {
    return null
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date.toISOString()
}

function toAnalyticsMetricItems(rows: Array<{ _id: string; value: number }>, fallback = '未知'): AnalyticsMetricItem[] {
  return rows.map((item) => ({
    name: sanitizeLabel(item._id, fallback),
    value: item.value,
  }))
}

function buildTrendSeries<T extends { _id: string; value: number }>(rows: T[], buckets: string[]): AnalyticsTrendItem[] {
  const map = new Map(rows.map((row) => [row._id, row.value]))
  return buckets.map((date) => ({
    date,
    value: map.get(date) ?? 0,
  }))
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
  const { endDate, startDate } = normalizeDateRange(start, end)
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
  return getTimeBucketRange(startDate, endDate, granularity)
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
    vehicleIdentifier: sanitizeLabel(input.vehicleIdentifier, ''),
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

async function getPunchDomainSummary(query: AnalyticsDomainQuery): Promise<AnalyticsDomainSummary> {
  const { startDate, endDate } = resolveDateRange(query.start, query.end)
  const granularity = normalizeGranularity(query.granularity)
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 50)
  const baseMatch = {
    createdAt: { $gte: startDate, $lte: endDate },
  }
  const [summaryRaw, trendRaw, breakdownRaw, recentRaw] = await Promise.all([
    PunchRecordModel.aggregate<{
      total: number
      users: Array<Types.ObjectId | null>
      scenes: string[]
      nodes: string[]
      vehicles: string[]
    }>([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          users: { $addToSet: '$userId' },
          scenes: { $addToSet: '$scenicId' },
          nodes: { $addToSet: '$nodeId' },
          vehicles: { $addToSet: { $ifNull: ['$vehicleIdentifier', ''] } },
        },
      },
    ]),
    PunchRecordModel.aggregate<{ _id: string; value: number }>([
      { $match: baseMatch },
      {
        $group: {
          _id: {
            $dateToString: {
              format: granularity === 'month' ? '%Y-%m' : '%Y-%m-%d',
              date: '$createdAt',
              timezone: 'Asia/Shanghai',
            },
          },
          value: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    PunchRecordModel.aggregate<{ _id: string; value: number }>([
      { $match: { ...baseMatch, scenicId: { $ne: '' } } },
      { $group: { _id: '$scenicId', value: { $sum: 1 } } },
      { $sort: { value: -1 } },
      { $limit: 10 },
    ]),
    PunchRecordModel.find(baseMatch)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec(),
  ])

  const summary = summaryRaw[0] ?? { total: 0, users: [], scenes: [], nodes: [], vehicles: [] }
  const trendBuckets = buildBuckets(startDate, endDate, granularity)
  const trend = buildTrendSeries(trendRaw, trendBuckets)
  return {
    key: 'punch',
    title: '打卡记录统计',
    summary: [
      { name: '打卡总数', value: summary.total },
      { name: '参与用户', value: summary.users.filter((item) => Boolean(item)).length },
      { name: '景点数量', value: summary.scenes.filter(Boolean).length },
      { name: '节点数量', value: summary.nodes.filter(Boolean).length },
      { name: '车辆标识', value: summary.vehicles.filter(Boolean).length },
    ],
    trend,
    breakdown: toAnalyticsMetricItems(breakdownRaw, '未知打卡景点'),
    recent: recentRaw.map((item: any) => ({
      id: String(item._id),
      title: item.sceneName || item.scenicId || '打卡记录',
      subtitle: item.nodeName || item.nodeId || null,
      value: item.vehicleIdentifier || item.vehicleName || null,
      status: item.source || null,
      createdAt: formatDateTime(item.createdAt),
      metadata: {
        userId: item.userId ? String(item.userId) : null,
        username: item.username || null,
        scenicId: item.scenicId || null,
        sceneId: item.sceneId || null,
      },
    })),
  }
}

async function getOrderDomainSummary(query: AnalyticsDomainQuery): Promise<AnalyticsDomainSummary> {
  const { startDate, endDate } = resolveDateRange(query.start, query.end)
  const granularity = normalizeGranularity(query.granularity)
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 50)
  const baseMatch = {
    createdAt: { $gte: startDate, $lte: endDate },
  }
  const [orderSummaryRaw, trendRaw, paymentRaw, refundRaw, businessRaw, recentRaw] = await Promise.all([
    OrderModel.aggregate<{
      total: number
      paid: number
      refunded: number
      totalAmount: number
      avgAmount: number
      users: Array<Types.ObjectId | null>
    }>([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          paid: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'succeeded'] }, 1, 0] } },
          refunded: { $sum: { $cond: [{ $in: ['$refundStatus', ['succeeded', 'processing', 'approved', 'applied']] }, 1, 0] } },
          totalAmount: { $sum: '$totalAmount' },
          avgAmount: { $avg: '$totalAmount' },
          users: { $addToSet: '$userId' },
        },
      },
    ]),
    OrderModel.aggregate<{ _id: string; value: number; amount: number }>([
      { $match: baseMatch },
      {
        $group: {
          _id: {
            $dateToString: {
              format: granularity === 'month' ? '%Y-%m' : '%Y-%m-%d',
              date: '$createdAt',
              timezone: 'Asia/Shanghai',
            },
          },
          value: { $sum: 1 },
          amount: { $sum: '$totalAmount' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    OrderModel.aggregate<{ _id: string; value: number }>([
      { $match: baseMatch },
      { $group: { _id: { $ifNull: ['$paymentStatus', 'unpaid'] }, value: { $sum: 1 } } },
      { $sort: { value: -1 } },
    ]),
    OrderModel.aggregate<{ _id: string; value: number }>([
      { $match: baseMatch },
      { $group: { _id: { $ifNull: ['$refundStatus', 'none'] }, value: { $sum: 1 } } },
      { $sort: { value: -1 } },
    ]),
    BusinessOrderModel.aggregate<{ _id: string; value: number }>([
      { $match: baseMatch },
      { $group: { _id: { $ifNull: ['$topStage', 'quote'] }, value: { $sum: 1 } } },
      { $sort: { value: -1 } },
    ]),
    OrderModel.find(baseMatch).sort({ createdAt: -1 }).limit(limit).lean().exec(),
  ])

  const summary = orderSummaryRaw[0] ?? { total: 0, paid: 0, refunded: 0, totalAmount: 0, avgAmount: 0, users: [] }
  const trendBuckets = buildBuckets(startDate, endDate, granularity)
  const trendMap = new Map(trendRaw.map((row) => [row._id, row]))
  const trend = trendBuckets.map((date) => {
    const row = trendMap.get(date)
    return {
      date,
      value: row?.value ?? 0,
      secondaryValue: row?.amount ?? 0,
    }
  })
  return {
    key: 'orders',
    title: '订单相关统计',
    summary: [
      { name: '订单总数', value: summary.total },
      { name: '已支付', value: summary.paid },
      { name: '已退款', value: summary.refunded },
      { name: '订单金额', value: Math.round(summary.totalAmount || 0) },
      { name: '下单用户', value: summary.users.filter((item) => Boolean(item)).length },
    ],
    trend,
    breakdown: [
      ...toAnalyticsMetricItems(paymentRaw, '未支付'),
      ...toAnalyticsMetricItems(refundRaw, '未设置退款状态'),
      ...toAnalyticsMetricItems(businessRaw, '商业订单阶段'),
    ].slice(0, 10),
    recent: recentRaw.map((item: any) => ({
      id: String(item._id),
      title: item.orderNumber || '订单',
      subtitle: item.paymentStatus || item.status || null,
      value: item.totalAmount ?? null,
      status: item.refundStatus || null,
      createdAt: formatDateTime(item.createdAt),
      metadata: {
        userId: item.userId ? String(item.userId) : null,
        paymentMethod: item.paymentMethod || null,
      },
    })),
  }
}

async function getVehicleDomainSummary(query: AnalyticsDomainQuery): Promise<AnalyticsDomainSummary> {
  const { startDate, endDate } = resolveDateRange(query.start, query.end)
  const granularity = normalizeGranularity(query.granularity)
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 50)
  const baseMatch = {
    createdAt: { $gte: startDate, $lte: endDate },
  }
  const [vehicleSummaryRaw, trendRaw, ownershipRaw, recentRaw] = await Promise.all([
    VehicleModel.aggregate<{
      total: number
      active: number
      defaultCount: number
    }>([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } },
          defaultCount: { $sum: { $cond: [{ $eq: ['$isDefault', true] }, 1, 0] } },
        },
      },
    ]),
    VehicleModel.aggregate<{ _id: string; value: number }>([
      { $match: baseMatch },
      {
        $group: {
          _id: {
            $dateToString: {
              format: granularity === 'month' ? '%Y-%m' : '%Y-%m-%d',
              date: '$createdAt',
              timezone: 'Asia/Shanghai',
            },
          },
          value: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    UserVehicleModel.aggregate<{ _id: Types.ObjectId; value: number }>([
      { $match: { vehicleId: { $ne: null } } },
      { $group: { _id: '$vehicleId', value: { $sum: 1 } } },
      { $sort: { value: -1 } },
      { $limit: 10 },
    ]),
    VehicleModel.find(baseMatch).sort({ createdAt: -1 }).limit(limit).lean().exec(),
  ])

  const summary = vehicleSummaryRaw[0] ?? { total: 0, active: 0, defaultCount: 0 }
  const trendBuckets = buildBuckets(startDate, endDate, granularity)
  const trend = buildTrendSeries(trendRaw, trendBuckets)
  const vehicleIds = ownershipRaw.map((row) => row._id).filter((value): value is Types.ObjectId => Boolean(value))
  const vehicles = vehicleIds.length
    ? await VehicleModel.find({ _id: { $in: vehicleIds } }).select({ name: 1, identifier: 1 }).lean().exec()
    : []
  const vehicleNameMap = new Map(vehicles.map((vehicle) => [String(vehicle._id), `${vehicle.name} (${vehicle.identifier})`]))
  return {
    key: 'vehicles',
    title: '车辆使用相关统计',
    summary: [
      { name: '车辆总数', value: summary.total },
      { name: '启用车辆', value: summary.active },
      { name: '默认车辆', value: summary.defaultCount },
      { name: '拥有关系', value: ownershipRaw.reduce((sum, item) => sum + item.value, 0) },
      { name: '车辆拥有者', value: vehicleIds.length },
    ],
    trend,
    breakdown: ownershipRaw.map((item) => ({
      name: vehicleNameMap.get(String(item._id)) ?? String(item._id),
      value: item.value,
    })),
    recent: recentRaw.map((item: any) => ({
      id: String(item._id),
      title: item.name || item.identifier || '车辆',
      subtitle: item.identifier || null,
      value: item.isActive ? '启用' : '停用',
      status: item.isDefault ? '默认' : null,
      createdAt: formatDateTime(item.createdAt),
      metadata: { coverUrl: item.coverUrl || null },
    })),
  }
}

async function getTravelDomainSummary(query: AnalyticsDomainQuery): Promise<AnalyticsDomainSummary> {
  const { startDate, endDate } = resolveDateRange(query.start, query.end)
  const granularity = normalizeGranularity(query.granularity)
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 50)
  const baseMatch = {
    createdAt: { $gte: startDate, $lte: endDate },
  }
  const [summaryRaw, trendRaw, breakdownRaw, recentRaw] = await Promise.all([
    TravelRecordModel.aggregate<{
      total: number
      completed: number
      active: number
      durationTotal: number
      durationAvg: number
      users: Array<Types.ObjectId | null>
    }>([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          durationTotal: { $sum: { $ifNull: ['$durationSeconds', 0] } },
          durationAvg: { $avg: { $ifNull: ['$durationSeconds', 0] } },
          users: { $addToSet: '$userId' },
        },
      },
    ]),
    TravelRecordModel.aggregate<{ _id: string; value: number; duration: number }>([
      { $match: baseMatch },
      {
        $group: {
          _id: {
            $dateToString: {
              format: granularity === 'month' ? '%Y-%m' : '%Y-%m-%d',
              date: '$createdAt',
              timezone: 'Asia/Shanghai',
            },
          },
          value: { $sum: 1 },
          duration: { $avg: { $ifNull: ['$durationSeconds', 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    TravelRecordModel.aggregate<{ _id: string; value: number }>([
      { $match: { ...baseMatch, scenicId: { $ne: '' } } },
      { $group: { _id: '$scenicId', value: { $sum: 1 } } },
      { $sort: { value: -1 } },
      { $limit: 10 },
    ]),
    TravelRecordModel.find(baseMatch).sort({ createdAt: -1 }).limit(limit).lean().exec(),
  ])

  const summary = summaryRaw[0] ?? { total: 0, completed: 0, active: 0, durationTotal: 0, durationAvg: 0, users: [] }
  const trendBuckets = buildBuckets(startDate, endDate, granularity)
  const trendMap = new Map(trendRaw.map((row) => [row._id, row]))
  const trend = trendBuckets.map((date) => {
    const row = trendMap.get(date)
    return {
      date,
      value: row?.value ?? 0,
      secondaryValue: row?.duration ?? 0,
    }
  })
  return {
    key: 'travel',
    title: '游历记录相关统计',
    summary: [
      { name: '游历总数', value: summary.total },
      { name: '已完成', value: summary.completed },
      { name: '进行中', value: summary.active },
      { name: '总时长(秒)', value: Math.round(summary.durationTotal || 0) },
      { name: '参与用户', value: summary.users.filter((item) => Boolean(item)).length },
    ],
    trend,
    breakdown: toAnalyticsMetricItems(breakdownRaw, '未知景点'),
    recent: recentRaw.map((item: any) => ({
      id: String(item._id),
      title: item.sceneName || item.scenicId || '游历记录',
      subtitle: item.vehicleIdentifier || null,
      value: typeof item.durationSeconds === 'number' ? item.durationSeconds : null,
      status: item.status || null,
      createdAt: formatDateTime(item.createdAt),
      metadata: {
        userId: item.userId ? String(item.userId) : null,
        scenicId: item.scenicId || null,
      },
    })),
  }
}

async function getUserDomainSummary(query: AnalyticsDomainQuery): Promise<AnalyticsDomainSummary> {
  const { startDate, endDate } = resolveDateRange(query.start, query.end)
  const granularity = normalizeGranularity(query.granularity)
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 50)
  const baseMatch = {
    createdAt: { $gte: startDate, $lte: endDate },
  }
  const [summaryRaw, trendRaw, genderRaw, contractRaw, recentRaw] = await Promise.all([
    AppUserModel.aggregate<{
      total: number
      active: number
      disabled: number
      signed: number
      withVehicle: number
    }>([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          disabled: { $sum: { $cond: [{ $eq: ['$status', 'disabled'] }, 1, 0] } },
          signed: { $sum: { $cond: [{ $eq: ['$contractStatus', 'signed'] }, 1, 0] } },
          withVehicle: { $sum: { $cond: [{ $ne: ['$currentVehicleId', null] }, 1, 0] } },
        },
      },
    ]),
    AppUserModel.aggregate<{ _id: string; value: number }>([
      { $match: baseMatch },
      {
        $group: {
          _id: {
            $dateToString: {
              format: granularity === 'month' ? '%Y-%m' : '%Y-%m-%d',
              date: '$createdAt',
              timezone: 'Asia/Shanghai',
            },
          },
          value: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    AppUserModel.aggregate<{ _id: string; value: number }>([
      { $match: { ...baseMatch, gender: { $ne: null } } },
      { $group: { _id: { $ifNull: ['$gender', 'unknown'] }, value: { $sum: 1 } } },
      { $sort: { value: -1 } },
    ]),
    AppUserModel.aggregate<{ _id: string; value: number }>([
      { $match: baseMatch },
      { $group: { _id: { $ifNull: ['$contractStatus', 'unsigned'] }, value: { $sum: 1 } } },
      { $sort: { value: -1 } },
    ]),
    AppUserModel.find(baseMatch).sort({ createdAt: -1 }).limit(limit).lean().exec(),
  ])

  const summary = summaryRaw[0] ?? { total: 0, active: 0, disabled: 0, signed: 0, withVehicle: 0 }
  const trendBuckets = buildBuckets(startDate, endDate, granularity)
  const trend = buildTrendSeries(trendRaw, trendBuckets)
  return {
    key: 'users',
    title: '用户信息相关统计',
    summary: [
      { name: '用户总数', value: summary.total },
      { name: '活跃用户', value: summary.active },
      { name: '禁用用户', value: summary.disabled },
      { name: '已签约', value: summary.signed },
      { name: '已绑车辆', value: summary.withVehicle },
    ],
    trend,
    breakdown: [...toAnalyticsMetricItems(genderRaw, '未知性别'), ...toAnalyticsMetricItems(contractRaw, '未知签约状态')].slice(0, 10),
    recent: recentRaw.map((item: any) => ({
      id: String(item._id),
      title: item.displayName || item.username || '用户',
      subtitle: item.username || item.email || null,
      value: item.contractStatus || null,
      status: item.status || null,
      createdAt: formatDateTime(item.createdAt),
      metadata: {
        gender: item.gender || null,
        currentVehicleId: item.currentVehicleId ? String(item.currentVehicleId) : null,
      },
    })),
  }
}

export async function getAnalyticsDashboard(query: AnalyticsSummaryQuery): Promise<AnalyticsDashboardResponse> {
  const overview = await getAnalyticsOverview(query)
  const [punch, orders, vehicles, travel, users] = await Promise.all([
    getPunchDomainSummary(query),
    getOrderDomainSummary(query),
    getVehicleDomainSummary(query),
    getTravelDomainSummary(query),
    getUserDomainSummary(query),
  ])

  return {
    ...overview,
    domains: {
      punch,
      orders,
      vehicles,
      travel,
      users,
    },
  }
}

export async function getAnalyticsDomainSummary(domain: AnalyticsDomainKey, query: AnalyticsDomainQuery): Promise<AnalyticsDomainSummary> {
  switch (domain) {
    case 'orders':
      return await getOrderDomainSummary(query)
    case 'punch':
      return await getPunchDomainSummary(query)
    case 'travel':
      return await getTravelDomainSummary(query)
    case 'users':
      return await getUserDomainSummary(query)
    case 'vehicles':
      return await getVehicleDomainSummary(query)
    default:
      return await getPunchDomainSummary(query)
  }
}
