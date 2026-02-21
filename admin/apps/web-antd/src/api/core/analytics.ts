import { requestClient } from '#/api/request'

export interface AnalyticsMetricItem {
  name: string
  value: number
}

export interface AnalyticsTrendItem {
  date: string
  pv: number
  uv: number
}

export interface LoginTrendItem {
  date: string
  success: number
  fail: number
}

export interface AnalyticsSpotItem {
  spotId: string
  name: string
  pv: number
  uv: number
}

export interface AnalyticsOverviewResponse {
  query: {
    start: string
    end: string
    granularity: 'day' | 'week' | 'month'
    spotId: null | string
  }
  overview: {
    pv: number
    uv: number
    loginSuccess: number
    loginFail: number
    avgDwellMs: number
  }
  trend: AnalyticsTrendItem[]
  loginTrend: LoginTrendItem[]
  sourceDistribution: AnalyticsMetricItem[]
  deviceDistribution: AnalyticsMetricItem[]
  behaviorPaths: AnalyticsMetricItem[]
  profile: {
    gender: AnalyticsMetricItem[]
    age: AnalyticsMetricItem[]
    interests: AnalyticsMetricItem[]
  }
  topSpots: AnalyticsSpotItem[]
}

export interface GetAnalyticsOverviewParams {
  start?: string
  end?: string
  granularity?: 'day' | 'week' | 'month'
  spotId?: string
}

export async function getAnalyticsOverviewApi(params: GetAnalyticsOverviewParams = {}) {
  return requestClient.get<AnalyticsOverviewResponse>('/admin/analytics/overview', { params })
}
