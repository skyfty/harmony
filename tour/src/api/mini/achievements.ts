import type { Achievement, CheckinProgressItem, ScenicCheckinProgressItem, TravelSummaryItem } from '@/types/achievement'
import { miniRequest } from '@harmony/utils'
import { ensureMiniAuth } from './session'

type ListAchievementsResponse = {
  total: number
  achievements: Achievement[]
  scenicCheckinProgresses?: ScenicCheckinProgressItem[]
  checkinProgresses?: CheckinProgressItem[]
  travelSummary?: TravelSummaryItem[]
}

export interface AchievementDashboardData {
  achievements: Achievement[]
  scenicCheckinProgresses: ScenicCheckinProgressItem[]
  checkinProgresses: CheckinProgressItem[]
  travelSummary: TravelSummaryItem[]
}

export async function listAchievements(keyword?: string): Promise<AchievementDashboardData> {
  await ensureMiniAuth()
  const response = await miniRequest<ListAchievementsResponse>('/achievements', {
    method: 'GET',
    query: {
      q: keyword?.trim() || undefined,
    },
  })
  return {
    achievements: Array.isArray(response.achievements) ? response.achievements : [],
    scenicCheckinProgresses: Array.isArray(response.scenicCheckinProgresses) ? response.scenicCheckinProgresses : [],
    checkinProgresses: Array.isArray(response.checkinProgresses) ? response.checkinProgresses : [],
    travelSummary: Array.isArray(response.travelSummary) ? response.travelSummary : [],
  }
}
