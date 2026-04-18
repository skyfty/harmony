import type { Context } from 'koa'
import {
  type AnalyticsDomainKey,
  getAnalyticsDashboard,
  getAnalyticsDomainSummary,
  getAnalyticsOverview,
} from '@/services/analyticsService'

export async function getAnalyticsOverviewData(ctx: Context): Promise<void> {
  const { start, end, granularity, spotId } = ctx.query as {
    start?: string
    end?: string
    granularity?: string
    spotId?: string
  }

  const data = await getAnalyticsOverview({
    start,
    end,
    granularity,
    spotId,
  })

  ctx.body = data
}

export async function getAnalyticsDashboardData(ctx: Context): Promise<void> {
  const { start, end, granularity, spotId } = ctx.query as {
    start?: string
    end?: string
    granularity?: string
    spotId?: string
  }

  const data = await getAnalyticsDashboard({
    start,
    end,
    granularity,
    spotId,
  })

  ctx.body = data
}

export async function getAnalyticsDomainSummaryData(ctx: Context): Promise<void> {
  const { domain } = ctx.params as { domain?: string }
  const { start, end, granularity, limit } = ctx.query as {
    start?: string
    end?: string
    granularity?: string
    limit?: string
  }

  if (!domain) {
    ctx.throw(400, 'domain is required')
  }

  const data = await getAnalyticsDomainSummary(domain as AnalyticsDomainKey, {
    start,
    end,
    granularity,
    limit: limit ? Number(limit) : undefined,
  })

  ctx.body = data
}
