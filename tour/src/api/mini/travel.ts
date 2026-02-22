import type { TravelRecordItem } from '@/types/achievement'
import { miniRequest } from '@harmony/utils'
import { ensureMiniAuth } from './session'

type ListTravelRecordsResponse = {
  data?: TravelRecordItem[]
  total?: number
}

export async function listTravelRecords(params?: { page?: number; pageSize?: number; sceneId?: string }) {
  await ensureMiniAuth()
  const response = await miniRequest<ListTravelRecordsResponse>('/travel-records', {
    method: 'GET',
    query: {
      page: params?.page ?? 1,
      pageSize: params?.pageSize ?? 50,
      sceneId: params?.sceneId,
    },
  })

  return {
    total: typeof response.total === 'number' ? response.total : 0,
    records: Array.isArray(response.data) ? response.data : [],
  }
}
