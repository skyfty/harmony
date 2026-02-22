import type { Context } from 'koa'
import { Types } from 'mongoose'
import { MiniFeedbackModel } from '@/models/MiniFeedback'
import type { MiniFeedbackCategory, MiniFeedbackStatus } from '@/types/models'
import { ensureUserId } from './utils'

const FEEDBACK_CATEGORIES: MiniFeedbackCategory[] = ['bug', 'ui', 'feature', 'content', 'other']
const FEEDBACK_STATUSES: MiniFeedbackStatus[] = ['new', 'in_progress', 'resolved', 'closed']

interface FeedbackLean {
  _id: Types.ObjectId
  category: MiniFeedbackCategory
  content: string
  contact?: string | null
  status: MiniFeedbackStatus
  reply?: string | null
  createdAt: Date
}

interface CreateFeedbackBody {
  category?: MiniFeedbackCategory
  content?: string
  contact?: string
}

function toFeedbackResponse(item: FeedbackLean) {
  return {
    id: item._id.toString(),
    category: item.category,
    content: item.content,
    contact: item.contact ?? undefined,
    status: item.status,
    reply: item.reply ?? undefined,
    createdAt: item.createdAt.toISOString(),
  }
}

export async function listFeedback(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { status, category } = ctx.query as { status?: string; category?: string }

  const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) }
  if (status && FEEDBACK_STATUSES.includes(status as MiniFeedbackStatus)) {
    filter.status = status
  }
  if (category && FEEDBACK_CATEGORIES.includes(category as MiniFeedbackCategory)) {
    filter.category = category
  }

  const list = (await MiniFeedbackModel.find(filter)
    .sort({ createdAt: -1 })
    .lean()
    .exec()) as FeedbackLean[]

  const feedback = list.map(toFeedbackResponse)
  ctx.body = {
    total: feedback.length,
    feedback,
  }
}

export async function createFeedback(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const body = ctx.request.body as CreateFeedbackBody

  const category = FEEDBACK_CATEGORIES.includes(body.category as MiniFeedbackCategory)
    ? (body.category as MiniFeedbackCategory)
    : 'other'
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const contact = typeof body.contact === 'string' ? body.contact.trim() : ''

  if (!content) {
    ctx.throw(400, 'Feedback content is required')
    return
  }

  const created = await MiniFeedbackModel.create({
    userId,
    category,
    content,
    contact: contact || null,
    status: 'new',
  })

  const feedback = (await MiniFeedbackModel.findById(created._id).lean().exec()) as FeedbackLean | null
  ctx.status = 201
  ctx.body = feedback ? toFeedbackResponse(feedback) : null
}
