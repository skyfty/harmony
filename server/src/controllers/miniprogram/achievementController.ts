import type { Context } from 'koa'
import { Types } from 'mongoose'
import { MiniAchievementModel } from '@/models/MiniAchievement'
import { SceneModel } from '@/models/Scene'
import { getCheckinProgressBySceneForUser, getTravelSummaryBySceneForUser } from '@/services/travelRecordService'
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
  const [checkinProgresses, travelSummary] = await Promise.all([
    getCheckinProgressBySceneForUser(userId),
    getTravelSummaryBySceneForUser(userId),
  ])

  const sceneIdSet = new Set<string>()
  checkinProgresses.forEach((item) => {
    if (item.sceneId) {
      sceneIdSet.add(item.sceneId)
    }
  })
  travelSummary.forEach((item) => {
    if (item.sceneId) {
      sceneIdSet.add(item.sceneId)
    }
  })

  const sceneMap = new Map<string, string>()
  const validSceneIds = Array.from(sceneIdSet).filter((sceneIdItem) => Types.ObjectId.isValid(sceneIdItem))
  if (validSceneIds.length) {
    const scenes = await SceneModel.find({ _id: { $in: validSceneIds.map((id) => new Types.ObjectId(id)) } }, { _id: 1, name: 1 })
      .lean()
      .exec()
    for (const scene of scenes) {
      sceneMap.set(scene._id.toString(), scene.name)
    }
  }

  ctx.body = {
    total: achievements.length,
    achievements,
    checkinProgresses: checkinProgresses.map((item) => ({
      sceneId: item.sceneId,
      sceneName: sceneMap.get(item.sceneId),
      checkedCount: item.checkedCount,
      totalCount: item.totalCount,
      ratio: item.totalCount > 0 ? item.checkedCount / item.totalCount : 0,
    })),
    travelSummary: travelSummary.map((item) => ({
      sceneId: item.sceneId,
      sceneName: item.sceneName || sceneMap.get(item.sceneId),
      visitedCount: item.visitedCount,
      totalDurationSeconds: item.totalDurationSeconds,
    })),
  }
}
