import type { Context } from 'koa'
import { Types } from 'mongoose'
import { MiniAchievementModel } from '@/models/MiniAchievement'
import { ensureUserId } from './utils'

interface AchievementLean {
  _id: Types.ObjectId
  title: string
  description: string
  progress: number
  scenicId?: Types.ObjectId | null
  achievedAt?: Date | null
}

function toAchievementResponse(item: AchievementLean) {
  return {
    id: item._id.toString(),
    title: item.title,
    description: item.description,
    progress: item.progress,
    scenicId: item.scenicId ? item.scenicId.toString() : undefined,
    achievedAt: item.achievedAt ? item.achievedAt.toISOString() : undefined,
  }
}

export async function listAchievements(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { q, scenicId } = ctx.query as { q?: string; scenicId?: string }

  const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) }
  if (q && q.trim()) {
    const keyword = q.trim()
    filter.$or = [{ title: new RegExp(keyword, 'i') }, { description: new RegExp(keyword, 'i') }]
  }
  if (scenicId && Types.ObjectId.isValid(scenicId)) {
    filter.scenicId = new Types.ObjectId(scenicId)
  }

  const list = (await MiniAchievementModel.find(filter)
    .sort({ achievedAt: -1, createdAt: -1 })
    .lean()
    .exec()) as AchievementLean[]

  const achievements = list.map(toAchievementResponse)
  ctx.body = {
    total: achievements.length,
    achievements,
  }
}
