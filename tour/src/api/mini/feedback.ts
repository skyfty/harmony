import type { FeedbackCategory, FeedbackTicket } from '@/types/feedback'
import { miniRequest } from '@harmony/utils'
import { ensureMiniAuth } from './session'

type ListFeedbackResponse = {
  total: number
  feedback: FeedbackTicket[]
}

type CreateFeedbackPayload = {
  category: FeedbackCategory
  content: string
  contact?: string
}

export async function listFeedback(): Promise<FeedbackTicket[]> {
  await ensureMiniAuth()
  const response = await miniRequest<ListFeedbackResponse>('/feedback', {
    method: 'GET',
  })
  return Array.isArray(response.feedback) ? response.feedback : []
}

export async function createFeedback(payload: CreateFeedbackPayload): Promise<FeedbackTicket> {
  await ensureMiniAuth()
  return await miniRequest<FeedbackTicket>('/feedback', {
    method: 'POST',
    body: {
      category: payload.category,
      content: payload.content,
      contact: payload.contact,
    },
  })
}
