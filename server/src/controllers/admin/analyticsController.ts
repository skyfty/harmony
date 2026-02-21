import type { Context } from 'koa'
import { getAnalyticsOverview } from '@/services/analyticsService'

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
