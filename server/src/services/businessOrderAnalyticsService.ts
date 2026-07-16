import { Types } from 'mongoose'
import { AnalyticsEventModel } from '@/models/AnalyticsEvent'
import { PunchRecordModel } from '@/models/PunchRecord'
import { SceneSpotModel } from '@/models/SceneSpot'

const VISIT_EVENT_TYPES = ['visit_exhibition', 'enter_scene', 'view_spot', 'page_view']

export type BusinessOrderAnalyticsGranularity = 'day' | 'month'
export type BusinessOrderAnalyticsDimension = 'checkpoint' | 'category'
export type BusinessOrderAnalyticsMetric = 'pv' | 'uv' | 'newUsers' | 'punchCount'

export interface BusinessOrderAnalyticsQuery {
  end?: string
  granularity?: BusinessOrderAnalyticsGranularity
  dimension?: BusinessOrderAnalyticsDimension
  metric?: BusinessOrderAnalyticsMetric
  sceneId: string
  sceneSpotId?: string | null
  limit?: number
  start?: string
}

export interface BusinessOrderAnalyticsChartSeries {
  name: string
  data: number[]
}

export interface BusinessOrderAnalyticsChartBlock {
  categories: string[]
  dimension?: BusinessOrderAnalyticsDimension
  granularity?: BusinessOrderAnalyticsGranularity
  metric?: BusinessOrderAnalyticsMetric
  series: BusinessOrderAnalyticsChartSeries[]
  total: number
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
  charts: {
    breakdown: BusinessOrderAnalyticsChartBlock
    trend: BusinessOrderAnalyticsChartBlock
  }
}

function parseDate(value?: string): Date | null {
  if (!value) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeDateRange(start?: string, end?: string, granularity: BusinessOrderAnalyticsGranularity = 'day'): { endDate: Date; startDate: Date } {
  const endDate = parseDate(end) ?? new Date()
  const fallbackDays = granularity === 'month' ? 11 : 29
  const startDate = parseDate(start) ?? new Date(endDate.getTime() - fallbackDays * 24 * 60 * 60 * 1000)
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

function formatMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function buildMonthBuckets(startDate: Date, endDate: Date): string[] {
  const buckets: string[] = []
  const cursor = new Date(startDate)
  cursor.setDate(1)
  cursor.setHours(0, 0, 0, 0)
  const endCursor = new Date(endDate)
  endCursor.setDate(1)
  endCursor.setHours(23, 59, 59, 999)
  while (cursor <= endCursor) {
    buckets.push(formatMonth(cursor))
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return buckets
}

function buildBuckets(startDate: Date, endDate: Date, granularity: BusinessOrderAnalyticsGranularity): string[] {
  return granularity === 'month' ? buildMonthBuckets(startDate, endDate) : buildDayBuckets(startDate, endDate)
}

function metricLabel(metric: BusinessOrderAnalyticsMetric): string {
  if (metric === 'pv') return '访问次数'
  if (metric === 'newUsers') return '新增用户'
  if (metric === 'punchCount') return '打卡次数'
  return '访问人数'
}

function createSeries(name: string, data: number[]): BusinessOrderAnalyticsChartSeries {
  return { name, data }
}

export async function getBusinessOrderAnalytics(query: BusinessOrderAnalyticsQuery): Promise<BusinessOrderAnalyticsResponse> {
  if (!Types.ObjectId.isValid(query.sceneId)) {
    throw new Error('Invalid scene id')
  }

  const granularity = query.granularity === 'month' ? 'month' : 'day'
  const dimension = query.dimension === 'category' ? 'category' : 'checkpoint'
  const metric = query.metric === 'pv' || query.metric === 'uv' || query.metric === 'newUsers' || query.metric === 'punchCount'
    ? query.metric
    : 'uv'
  const limit = Math.min(Math.max(Number(query.limit) || 8, 1), 20)
  const { startDate, endDate } = normalizeDateRange(query.start, query.end, granularity)
  const startBucket = new Date(startDate)
  startBucket.setHours(0, 0, 0, 0)
  const endBucket = new Date(endDate)
  endBucket.setHours(23, 59, 59, 999)
  const todayStart = new Date(endBucket)
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(endBucket)
  todayEnd.setHours(23, 59, 59, 999)
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
  }
  if (sceneSpotObjectId) {
    punchMatch.scenicId = query.sceneSpotId
  } else {
    punchMatch.sceneId = query.sceneId
  }

  const trendFormat = granularity === 'month' ? '%Y-%m' : '%Y-%m-%d'
  const chartBuckets = buildBuckets(startBucket, endBucket, granularity)

  const breakdownPromise = dimension === 'category'
    ? PunchRecordModel.aggregate<{ _id: { scenicId: string }; total: number; users: Array<Types.ObjectId | null> }>([
        { $match: punchMatch },
        {
          $group: {
            _id: {
              scenicId: { $ifNull: ['$scenicId', ''] },
            },
            total: { $sum: 1 },
            users: { $addToSet: '$userId' },
          },
        },
        { $sort: { total: -1, '_id.scenicId': 1 } },
        { $limit: limit },
      ])
    : PunchRecordModel.aggregate<{ _id: { nodeId: string; nodeName: string }; total: number; users: Array<Types.ObjectId | null> }>([
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
        { $limit: limit },
      ])

  const [visitAgg, trendRaw, firstVisitRaw, punchTrendRaw, totalPunchCount, checkpointStatsRaw, todayVisitAgg, todayFirstVisitRaw] = await Promise.all([
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
              format: trendFormat,
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
              format: trendFormat,
              timezone: 'Asia/Shanghai',
            },
          },
          users: { $push: '$_id' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    metric === 'punchCount'
      ? PunchRecordModel.aggregate<{ _id: string; total: number }>([
          {
            $match: {
              ...punchMatch,
              createdAt: { $gte: startBucket, $lte: endBucket },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  date: '$createdAt',
                  format: trendFormat,
                  timezone: 'Asia/Shanghai',
                },
              },
              total: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ])
      : Promise.resolve([] as Array<{ _id: string; total: number }>),
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
      { $limit: limit },
    ]),
    AnalyticsEventModel.aggregate<{ pv: number; users: Array<Types.ObjectId | null> }>([
      {
        $match: {
          ...visitMatch,
          occurredAt: { $gte: todayStart, $lte: todayEnd },
        },
      },
      {
        $group: {
          _id: null,
          pv: { $sum: 1 },
          users: { $addToSet: '$userId' },
        },
      },
    ]),
    AnalyticsEventModel.aggregate<{ _id: string; users: Array<Types.ObjectId | null> }>([
      {
        $match: {
          ...visitMatch,
          occurredAt: { $gte: todayStart, $lte: todayEnd },
          userId: { $ne: null },
        },
      },
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
  ])

  const breakdownRaw = await breakdownPromise

  const overview = visitAgg[0] ?? { pv: 0, users: [] }
  const totalUv = overview.users.filter((user) => Boolean(user)).length
  const todayOverview = todayVisitAgg[0] ?? { pv: 0, users: [] }
  const todayUv = todayOverview.users.filter((user) => Boolean(user)).length
  const todayNewUsers = todayFirstVisitRaw.reduce((sum, row) => sum + row.users.filter((item) => Boolean(item)).length, 0)

  const trendMap = new Map(trendRaw.map((row) => [row._id, row]))
  const newUserMap = new Map(firstVisitRaw.map((row) => [row._id, row.users.filter((item) => Boolean(item)).length]))
  const punchTrendMap = new Map(punchTrendRaw.map((row) => [row._id, row.total]))
  const visitTrend = chartBuckets.map((date) => {
    const row = trendMap.get(date)
    const firstVisit = newUserMap.get(date) ?? 0
    return {
      date,
      pv: row?.pv ?? 0,
      uv: row?.users.filter((user) => Boolean(user)).length ?? 0,
      newUsers: firstVisit,
    }
  })
  const trendSeriesData = chartBuckets.map((date) => {
    const row = trendMap.get(date)
    if (metric === 'pv') {
      return row?.pv ?? 0
    }
    if (metric === 'newUsers') {
      return newUserMap.get(date) ?? 0
    }
    if (metric === 'punchCount') {
      return punchTrendMap.get(date) ?? 0
    }
    return row?.users.filter((user) => Boolean(user)).length ?? 0
  })

  const chartTrend: BusinessOrderAnalyticsChartBlock = {
    granularity,
    metric,
    categories: chartBuckets,
    series: [createSeries(metricLabel(metric), trendSeriesData)],
    total: trendSeriesData.reduce((sum, item) => sum + item, 0),
  }

  const checkpointStats = checkpointStatsRaw.map((row) => ({
    nodeId: row._id.nodeId || '',
    nodeName: row._id.nodeName || '未命名打卡点',
    punchCount: row.total,
    userCount: row.users.filter((item) => Boolean(item)).length,
  }))

  const breakdownCategories: string[] = []
  const breakdownPunchCounts: number[] = []
  const breakdownUserCounts: number[] = []

  if (dimension === 'category') {
    const categoryRows = breakdownRaw as Array<{ _id: { scenicId?: string }; total: number; users: Array<Types.ObjectId | null> }>
    const scenicIds = Array.from(new Set(categoryRows.map((row) => String(row._id.scenicId ?? '')).filter((item) => Boolean(item))))
    const scenicTitleMap = new Map<string, string>()
    if (scenicIds.length) {
      const scenicRows = await SceneSpotModel.find({ _id: { $in: scenicIds } }, { _id: 1, title: 1 }).lean().exec()
      scenicRows.forEach((row) => {
        scenicTitleMap.set(String(row._id), String((row as { title?: string }).title ?? '').trim() || '未命名场景点')
      })
    }
    categoryRows.forEach((row) => {
      const scenicId = String(row._id.scenicId ?? '')
      breakdownCategories.push(scenicTitleMap.get(scenicId) ?? '未命名场景点')
      breakdownPunchCounts.push(row.total)
      breakdownUserCounts.push(row.users.filter((item) => Boolean(item)).length)
    })
  } else {
    const checkpointRows = breakdownRaw as Array<{ _id: { nodeName?: string }; total: number; users: Array<Types.ObjectId | null> }>
    checkpointRows.forEach((row) => {
      breakdownCategories.push(String(row._id.nodeName ?? '未命名打卡点'))
      breakdownPunchCounts.push(row.total)
      breakdownUserCounts.push(row.users.filter((item) => Boolean(item)).length)
    })
  }

  const chartBreakdown: BusinessOrderAnalyticsChartBlock = {
    dimension,
    categories: breakdownCategories,
    series: [
      createSeries('访问次数', breakdownPunchCounts),
      createSeries('访问人数', breakdownUserCounts),
    ],
    total: breakdownPunchCounts.reduce((sum, item) => sum + item, 0),
  }

  return {
    overview: {
      totalUv,
      todayUv,
      todayNewUsers,
      totalPunchCount,
    },
    visitTrend,
    checkpointStats,
    charts: {
      trend: chartTrend,
      breakdown: chartBreakdown,
    },
    query: {
      start: startBucket.toISOString(),
      end: endBucket.toISOString(),
      sceneId: query.sceneId,
      sceneSpotId: query.sceneSpotId ?? null,
    },
  }
}
