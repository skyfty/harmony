import { apiClient } from '@/api/http'
import type { DashboardMetrics } from '@/types'

export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  const { data } = await apiClient.get<DashboardMetrics>('/api/dashboard/metrics')
  return data
}
