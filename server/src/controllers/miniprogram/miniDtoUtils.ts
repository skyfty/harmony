import type { Types } from 'mongoose'
import type { SceneDocument, UserCouponStatus, UserProductState } from '@/types/models'

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry) => typeof entry === 'string') as string[]
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function pickSceneMetadata(scene: Partial<SceneDocument> & { metadata?: unknown }): Record<string, unknown> {
  const meta = scene.metadata
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    return meta as Record<string, unknown>
  }
  return {}
}

export function getSceneTags(meta: Record<string, unknown>): string[] {
  const tags = meta.sceneTags ?? meta.tags
  return asStringArray(tags)
}

export function isProductApplicableToScene(product: { applicableSceneTags?: unknown }, sceneTags: string[]): boolean {
  const applicable = Array.isArray((product as any).applicableSceneTags) ? ((product as any).applicableSceneTags as string[]) : []
  if (applicable.length === 0) {
    return true
  }
  if (applicable.includes('*')) {
    return true
  }
  if (sceneTags.length === 0) {
    return false
  }
  return applicable.some((tag) => sceneTags.includes(tag))
}

export function computeUserCouponStatus(entry: {
  status?: UserCouponStatus
  expiresAt?: Date | null
  usedAt?: Date | null
}, now = new Date()): UserCouponStatus {
  const expiresAt = entry.expiresAt ?? null
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return 'expired'
  }
  if (entry.usedAt) {
    return 'used'
  }
  if (entry.status === 'used' || entry.status === 'expired') {
    return entry.status
  }
  return 'unused'
}

export function computeUserProductState(entry: {
  state?: UserProductState
  expiresAt?: Date | null
  usedAt?: Date | null
} | null, now = new Date()): UserProductState {
  if (!entry) {
    return 'unused'
  }
  const expiresAt = entry.expiresAt ?? null
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return 'expired'
  }
  if (entry.usedAt) {
    return 'used'
  }
  if (entry.state === 'locked' || entry.state === 'used' || entry.state === 'expired') {
    return entry.state
  }
  return 'unused'
}

export function objectIdString(id: Types.ObjectId | string | undefined | null): string {
  if (!id) {
    return ''
  }
  return typeof id === 'string' ? id : id.toString()
}
