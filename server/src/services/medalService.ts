import { Types } from 'mongoose'
import { MedalModel } from '@/models/Medal'
import { AnalyticsEventModel } from '@/models/AnalyticsEvent'
import { PunchRecordModel } from '@/models/PunchRecord'
import { TravelRecordModel } from '@/models/TravelRecord'
import { UserMedalModel } from '@/models/UserMedal'
import type { MedalRule, MedalRuleCompleteType, MedalRuleScope, MedalRuleType } from '@/types/models'
import { getCheckinProgressByScenicForUser } from '@/services/travelRecordService'

type MedalLean = {
  _id: Types.ObjectId
  name: string
  description?: string | null
  lockedIconUrl?: string | null
  unlockedIconUrl?: string | null
  enabled: boolean
  sort: number
  rules?: MedalRule[]
  metadata?: Record<string, unknown> | null
  createdAt?: Date
  updatedAt?: Date
}

type UserMedalLean = {
  medalId: Types.ObjectId
  awardedAt?: Date | null
}

type MedalUserStats = {
  enteredScenicIds: Set<string>
  enterCount: number
  uniquePunchCount: number
  scenicRatioById: Map<string, number>
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toPositiveInt(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return Math.floor(parsed)
}

function toPercent(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return Math.max(0, Math.min(100, parsed))
}

function toScope(value: unknown): MedalRuleScope {
  return value === 'specific_scenic' ? 'specific_scenic' : 'any_scenic'
}

function toCompleteType(value: unknown): MedalRuleCompleteType {
  return value === 'punch_ratio_gte' ? 'punch_ratio_gte' : 'enter_scenic'
}

async function buildUserStats(userId: string): Promise<MedalUserStats> {
  const userObjectId = new Types.ObjectId(userId)

  const [travelRows, punchRows, scenicProgresses, enterEventCount] = await Promise.all([
    TravelRecordModel.find({ userId: userObjectId }, { scenicId: 1 }).lean().exec(),
    PunchRecordModel.find({ userId: userObjectId }, { scenicId: 1, nodeId: 1 }).lean().exec(),
    getCheckinProgressByScenicForUser(userId),
    AnalyticsEventModel.countDocuments({ userId: userObjectId, eventType: 'enter_scene' }),
  ])

  const enteredScenicIds = new Set<string>()
  for (const row of travelRows) {
    const scenicId = toStringValue((row as { scenicId?: unknown }).scenicId)
    if (scenicId) {
      enteredScenicIds.add(scenicId)
    }
  }

  const punchKeySet = new Set<string>()
  for (const row of punchRows) {
    const scenicId = toStringValue((row as { scenicId?: unknown }).scenicId)
    const nodeId = toStringValue((row as { nodeId?: unknown }).nodeId)
    if (scenicId && nodeId) {
      punchKeySet.add(`${scenicId}::${nodeId}`)
    }
  }

  const scenicRatioById = new Map<string, number>()
  for (const item of scenicProgresses) {
    const scenicId = toStringValue(item.scenicId)
    if (scenicId) {
      scenicRatioById.set(scenicId, toPercent((item.ratio ?? 0) * 100))
    }
  }

  return {
    enteredScenicIds,
    enterCount: Number.isFinite(enterEventCount) && enterEventCount > 0 ? enterEventCount : 0,
    uniquePunchCount: punchKeySet.size,
    scenicRatioById,
  }
}

function evaluateScenicRule(ruleType: 'enter_scenic' | 'punch_ratio_gte', params: Record<string, unknown>, stats: MedalUserStats): boolean {
  const scope = toScope(params.scope)
  const scenicId = toStringValue(params.scenicId)
  const scenicCount = Math.max(toPositiveInt(params.scenicCount, 1), 1)
  const threshold = toPercent(params.conditionValue)

  if (scope === 'specific_scenic') {
    if (!scenicId) {
      return false
    }
    if (ruleType === 'enter_scenic') {
      return stats.enteredScenicIds.has(scenicId)
    }
    return (stats.scenicRatioById.get(scenicId) ?? 0) >= threshold
  }

  if (ruleType === 'enter_scenic') {
    return stats.enteredScenicIds.size >= scenicCount
  }

  let matched = 0
  for (const ratio of stats.scenicRatioById.values()) {
    if (ratio >= threshold) {
      matched += 1
    }
  }
  return matched >= scenicCount
}

function evaluateSpecificSetComplete(params: Record<string, unknown>, stats: MedalUserStats): boolean {
  const scenicIds = Array.isArray(params.scenicIds)
    ? Array.from(new Set(params.scenicIds.map((item) => toStringValue(item)).filter(Boolean)))
    : []
  if (!scenicIds.length) {
    return false
  }

  const completeType = toCompleteType(params.completeType)
  const completeValue = toPercent(params.completeValue)

  if (completeType === 'enter_scenic') {
    return scenicIds.every((scenicId) => stats.enteredScenicIds.has(scenicId))
  }

  return scenicIds.every((scenicId) => (stats.scenicRatioById.get(scenicId) ?? 0) >= completeValue)
}

function evaluateRule(rule: MedalRule, stats: MedalUserStats): boolean {
  const params = toRecord(rule.params)

  switch (rule.type as MedalRuleType) {
    case 'enter_scenic': {
      return evaluateScenicRule('enter_scenic', params, stats)
    }
    case 'punch_ratio_gte': {
      return evaluateScenicRule('punch_ratio_gte', params, stats)
    }
    case 'enter_count_gte': {
      return stats.enterCount >= toPositiveInt(params.threshold)
    }
    case 'punch_count_gte': {
      return stats.uniquePunchCount >= toPositiveInt(params.threshold)
    }
    case 'specific_scenic_set_complete': {
      return evaluateSpecificSetComplete(params, stats)
    }
    default: {
      return false
    }
  }
}

function mapMedalForUser(medal: MedalLean, earnedRow?: UserMedalLean) {
  const lockedIconUrl = toStringValue(medal.lockedIconUrl)
  const unlockedIconUrl = toStringValue(medal.unlockedIconUrl)
  const earned = Boolean(earnedRow)

  return {
    id: medal._id.toString(),
    name: medal.name,
    description: medal.description ?? null,
    lockedIconUrl: lockedIconUrl || null,
    unlockedIconUrl: unlockedIconUrl || null,
    displayIconUrl: earned ? unlockedIconUrl || lockedIconUrl || null : lockedIconUrl || unlockedIconUrl || null,
    earned,
    awardedAt: earnedRow?.awardedAt ? earnedRow.awardedAt.toISOString() : null,
    sort: medal.sort,
  }
}

export async function listMedalsForUser(userId: string) {
  if (!Types.ObjectId.isValid(userId)) {
    return []
  }

  const userObjectId = new Types.ObjectId(userId)
  const [medals, earnedRows] = await Promise.all([
    MedalModel.find({ enabled: true }).sort({ sort: 1, createdAt: -1 }).lean().exec() as Promise<MedalLean[]>,
    UserMedalModel.find({ userId: userObjectId }, { medalId: 1, awardedAt: 1 }).lean().exec() as Promise<UserMedalLean[]>,
  ])

  const earnedMap = new Map<string, UserMedalLean>()
  for (const row of earnedRows) {
    earnedMap.set(row.medalId.toString(), row)
  }

  return medals.map((medal) => mapMedalForUser(medal, earnedMap.get(medal._id.toString())))
}

export async function evaluatePendingMedalsForUser(userId: string, triggerSource: string): Promise<string[]> {
  if (!Types.ObjectId.isValid(userId)) {
    return []
  }

  const userObjectId = new Types.ObjectId(userId)
  const [medals, userMedals] = await Promise.all([
    MedalModel.find({ enabled: true }).sort({ sort: 1, createdAt: -1 }).lean().exec() as Promise<MedalLean[]>,
    UserMedalModel.find({ userId: userObjectId }, { medalId: 1 }).lean().exec() as Promise<Array<{ medalId: Types.ObjectId }>>,
  ])

  const ownedIds = new Set(userMedals.map((item) => item.medalId.toString()))
  const pending = medals.filter((medal) => !ownedIds.has(medal._id.toString()))
  if (!pending.length) {
    return []
  }

  const stats = await buildUserStats(userId)
  const awardedIds: string[] = []

  for (const medal of pending) {
    const rules = Array.isArray(medal.rules) ? medal.rules : []
    if (!rules.length) {
      continue
    }
    const passed = rules.every((rule) => evaluateRule(rule, stats))
    if (!passed) {
      continue
    }

    try {
      await UserMedalModel.create({
        userId: userObjectId,
        medalId: medal._id,
        awardedAt: new Date(),
        triggerSource,
      })
      awardedIds.push(medal._id.toString())
    } catch (error: any) {
      if (error?.code !== 11000) {
        throw error
      }
    }
  }

  return awardedIds
}