import type { BehaviorEventType, SceneBehavior } from '@harmony/schema'
import { cloneBehavior, cloneBehaviorList, createBehaviorSequenceId, ensureBehaviorParams } from '@schema/behaviors/definitions'
import { generateUuid } from '@/utils/uuid'

export const BEHAVIOR_PREFAB_FORMAT_VERSION = 1

export interface BehaviorPrefabData {
  formatVersion: number
  name: string
  action: BehaviorEventType
  sequence: SceneBehavior[]
}

function normalizeName(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

function sanitizeSequence(
  input: SceneBehavior[],
  action: BehaviorEventType,
  sequenceId: string,
  name: string,
): SceneBehavior[] {
  return cloneBehaviorList(input).map((step) => {
    const clone = cloneBehavior(step)
    clone.id = clone.id && clone.id.trim().length ? clone.id : generateUuid()
    clone.sequenceId = sequenceId
    clone.action = action
    clone.name = name
    clone.script = ensureBehaviorParams(clone.script)
    return clone
  })
}

export function createBehaviorPrefabData(payload: {
  name: string
  action: BehaviorEventType
  sequence: SceneBehavior[]
}): BehaviorPrefabData {
  const normalizedName = normalizeName(payload.name) || 'Unnamed Behavior'
  const baseSequenceId = payload.sequence[0]?.sequenceId && payload.sequence[0]?.sequenceId.trim().length
    ? payload.sequence[0]!.sequenceId.trim()
    : createBehaviorSequenceId()
  const sanitizedSequence = sanitizeSequence(payload.sequence, payload.action, baseSequenceId, normalizedName)
  return {
    formatVersion: BEHAVIOR_PREFAB_FORMAT_VERSION,
    name: normalizedName,
    action: payload.action,
    sequence: sanitizedSequence,
  }
}

export function serializeBehaviorPrefab(payload: BehaviorPrefabData): string {
  const normalized = createBehaviorPrefabData(payload)
  return JSON.stringify(normalized, null, 2)
}

export function deserializeBehaviorPrefab(raw: string): BehaviorPrefabData {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid behavior prefab JSON: ${(error as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Behavior prefab payload must be an object')
  }
  const candidate = parsed as Partial<BehaviorPrefabData> & { action?: unknown; sequence?: unknown; name?: unknown; formatVersion?: unknown }
  const formatVersion = Number.isFinite(candidate.formatVersion) ? Number(candidate.formatVersion) : BEHAVIOR_PREFAB_FORMAT_VERSION
  if (formatVersion !== BEHAVIOR_PREFAB_FORMAT_VERSION) {
    throw new Error(`Unsupported behavior prefab version: ${candidate.formatVersion}`)
  }
  if (typeof candidate.action !== 'string') {
    throw new Error('Behavior prefab payload is missing a valid action field')
  }
  const sequence = Array.isArray(candidate.sequence) ? (candidate.sequence as SceneBehavior[]) : []
  const normalized = createBehaviorPrefabData({
    name: typeof candidate.name === 'string' ? candidate.name : '',
    action: candidate.action as BehaviorEventType,
    sequence,
  })
  return {
    ...normalized,
    formatVersion: BEHAVIOR_PREFAB_FORMAT_VERSION,
  }
}

function applyDefaultTarget(step: SceneBehavior, nodeId: string | null): void {
  if (!nodeId) {
    return
  }
  const params = step.script?.params as { targetNodeId?: string | null } | undefined
  switch (step.script?.type) {
    case 'show':
    case 'hide':
    case 'watch':
    case 'animation':
    case 'moveTo':
      if (params && Object.prototype.hasOwnProperty.call(params, 'targetNodeId') && params.targetNodeId === null) {
        params.targetNodeId = nodeId
      }
      break
    default:
      break
  }
}

export function instantiateBehaviorPrefab(
  prefab: BehaviorPrefabData,
  options: { nodeId?: string | null } = {},
): { sequenceId: string; sequence: SceneBehavior[]; action: BehaviorEventType; name: string } {
  const name = normalizeName(prefab.name) || 'Unnamed Behavior'
  const sequenceId = createBehaviorSequenceId()
  const cloned = cloneBehaviorList(prefab.sequence).map((step) => {
    const clone = cloneBehavior(step)
    clone.id = generateUuid()
    clone.sequenceId = sequenceId
    clone.action = prefab.action
    clone.name = name
    clone.script = ensureBehaviorParams(clone.script)
    applyDefaultTarget(clone, options.nodeId ?? null)
    return clone
  })
  return {
    sequenceId,
    sequence: cloned,
    action: prefab.action,
    name,
  }
}

export function buildBehaviorPrefabFilename(name: string): string {
  const normalized = normalizeName(name) || 'Unnamed Behavior'
  const sanitized = normalized
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  const base = sanitized.length ? sanitized : 'UnnamedBehavior'
  return `${base}.behavior`
}
