import type { ScenicDetail, ScenicSummary } from '@/types/scenic'
import type { ScenicComment, ScenicCommentStatus } from '@/types/comment'
import { miniRequest } from '@harmony/utils'
import { ensureMiniAuth } from './session'

export type ListScenicsResponse = {
  total: number
  sceneSpots: ScenicSummary[]
}

export async function listScenics(query?: { featured?: boolean; q?: string }): Promise<ScenicSummary[]> {
  const res = await miniRequest<ListScenicsResponse>('/scene-spots', {
    method: 'GET',
    query: {
      featured: query?.featured === undefined ? undefined : query.featured ? '1' : '0',
      q: query?.q,
    },
  })
  return Array.isArray(res.sceneSpots) ? res.sceneSpots : []
}

export type GetScenicResponse = {
  sceneSpot: ScenicDetail
}

export async function getScenic(id: string): Promise<ScenicDetail | null> {
  if (!id) return null
  const res = await miniRequest<GetScenicResponse>(`/scene-spots/${encodeURIComponent(id)}`, { method: 'GET' })
  return res?.sceneSpot ?? null
}

export type ScenicInteractionResponse = {
  averageRating: number
  ratingCount: number
  favoriteCount: number
  favorited: boolean
  userRating: number | null
}

export async function toggleScenicFavorite(id: string): Promise<ScenicInteractionResponse> {
  return await miniRequest<ScenicInteractionResponse>(`/scene-spots/${encodeURIComponent(id)}/favorite`, {
    method: 'POST',
  })
}

export async function rateScenic(id: string, score: number): Promise<ScenicInteractionResponse> {
  return await miniRequest<ScenicInteractionResponse>(`/scene-spots/${encodeURIComponent(id)}/rate`, {
    method: 'POST',
    body: { score },
  })
}

type ListScenicCommentsResponse = {
  data: ScenicComment[]
  total: number
  page: number
  pageSize: number
}

type CreateScenicCommentResponse = {
  comment: ScenicComment
}

export async function listScenicComments(
  id: string,
  query?: { page?: number; pageSize?: number },
): Promise<{ items: ScenicComment[]; total: number }> {
  if (!id) {
    return { items: [], total: 0 }
  }
  const response = await miniRequest<ListScenicCommentsResponse>(
    `/scene-spots/${encodeURIComponent(id)}/comments`,
    {
      method: 'GET',
      query: {
        page: query?.page,
        pageSize: query?.pageSize,
      },
    },
  )
  return {
    items: Array.isArray(response.data) ? response.data : [],
    total: Number(response.total || 0),
  }
}

export async function createScenicComment(
  id: string,
  content: string,
): Promise<ScenicComment> {
  await ensureMiniAuth()
  const response = await miniRequest<CreateScenicCommentResponse>(
    `/scene-spots/${encodeURIComponent(id)}/comments`,
    {
      method: 'POST',
      body: { content },
    },
  )
  return response.comment
}

export async function deleteScenicComment(id: string, commentId: string): Promise<void> {
  await ensureMiniAuth()
  await miniRequest(`/scene-spots/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`, {
    method: 'DELETE',
  })
}

export function getScenicCommentStatusLabel(status: ScenicCommentStatus): string {
  if (status === 'approved') return '已通过'
  if (status === 'rejected') return '已驳回'
  return '待审核'
}
