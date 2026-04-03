import type { Achievement, CheckinProgressItem, MedalItem, ScenicCheckinProgressItem, TravelSummaryItem } from '@/types/achievement'
import { miniRequest } from '@harmony/utils'
import { ensureMiniAuth } from './session'

type ListAchievementsResponse = {
  total: number
  achievements: Achievement[]
  medals?: MedalItem[]
  scenicCheckinProgresses?: ScenicCheckinProgressItem[]
  checkinProgresses?: CheckinProgressItem[]
  travelSummary?: TravelSummaryItem[]
}

export interface AchievementDashboardData {
  achievements: Achievement[]
  medals: MedalItem[]
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
    medals: Array.isArray(response.medals) ? response.medals : [],
    scenicCheckinProgresses: Array.isArray(response.scenicCheckinProgresses) ? response.scenicCheckinProgresses : [],
    checkinProgresses: Array.isArray(response.checkinProgresses) ? response.checkinProgresses : [],
    travelSummary: Array.isArray(response.travelSummary) ? response.travelSummary : [],
  }
}
