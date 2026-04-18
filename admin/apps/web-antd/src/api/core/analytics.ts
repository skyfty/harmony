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

export interface AnalyticsDomainTrendItem {
  date: string
  value: number
  secondaryValue?: number
}

export interface LoginTrendItem {
  date: string
  success: number
  fail: number
}

export type AnalyticsDomainKey = 'orders' | 'punch' | 'travel' | 'users' | 'vehicles'

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
  trend: AnalyticsDomainTrendItem[]
  breakdown: AnalyticsMetricItem[]
  recent: AnalyticsRecentItem[]
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
  domains?: Record<AnalyticsDomainKey, AnalyticsDomainSummary>
}

export interface AnalyticsDashboardResponse extends AnalyticsOverviewResponse {
  domains: Record<AnalyticsDomainKey, AnalyticsDomainSummary>
}

export interface AnalyticsDomainSummaryResponse extends AnalyticsDomainSummary {
  query: {
    start: string
    end: string
    granularity: 'day' | 'week' | 'month'
    limit?: number
  }
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

export async function getAnalyticsDashboardApi(params: GetAnalyticsOverviewParams = {}) {
  return requestClient.get<AnalyticsDashboardResponse>('/admin/analytics/dashboard', { params })
}

export async function getAnalyticsDomainSummaryApi(domain: AnalyticsDomainKey, params: GetAnalyticsOverviewParams & { limit?: number } = {}) {
  return requestClient.get<AnalyticsDomainSummaryResponse>(`/admin/analytics/${domain}`, { params })
}
