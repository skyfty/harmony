import type { Achievement } from '@/types/achievement'
import { miniRequest } from './client'
import { ensureMiniAuth } from './session'

type ListAchievementsResponse = {
  total: number
  achievements: Achievement[]
}

export async function listAchievements(keyword?: string): Promise<Achievement[]> {
  await ensureMiniAuth()
  const response = await miniRequest<ListAchievementsResponse>('/achievements', {
    method: 'GET',
    query: {
      q: keyword?.trim() || undefined,
    },
  })
  return Array.isArray(response.achievements) ? response.achievements : []
}
