import type { Object3D } from 'three'
import type {
  BehaviorActionType,
  SceneBehavior,
  SceneBehaviorScriptBinding,
  ShowAlertBehaviorParams,
} from '../index'
import { cloneBehaviorList, ensureBehaviorParams } from './definitions'

export type BehaviorTriggerContext = {
  pointerEvent?: PointerEvent | MouseEvent | TouchEvent
  intersection?: {
    object: Object3D
    point: { x: number; y: number; z: number }
  }
  payload?: Record<string, unknown>
}

export type BehaviorRuntimeEvent =
  | {
      type: 'show-alert'
      nodeId: string
      behaviorId: string
      params: ShowAlertBehaviorParams
    }

type RegistryEntry = {
  nodeId: string
  behaviors: SceneBehavior[]
  object: Object3D | null
}

const registry = new Map<string, RegistryEntry>()

function sanitizeBinding(binding: SceneBehaviorScriptBinding): SceneBehaviorScriptBinding {
  return ensureBehaviorParams(binding)
}

function sanitizeBehaviorList(list: SceneBehavior[]): SceneBehavior[] {
  return list.map((behavior) => ({
    id: behavior.id,
    name: behavior.name,
    action: behavior.action,
    script: sanitizeBinding(behavior.script),
  }))
}

export function resetBehaviorRuntime(): void {
  registry.clear()
}

export function registerBehaviorComponent(
  nodeId: string,
  behaviors: SceneBehavior[] = [],
  object: Object3D | null,
): void {
  registry.set(nodeId, {
    nodeId,
    behaviors: sanitizeBehaviorList(cloneBehaviorList(behaviors)),
    object,
  })
}

export function updateBehaviorComponent(nodeId: string, behaviors: SceneBehavior[]): void {
  const entry = registry.get(nodeId)
  if (!entry) {
    registerBehaviorComponent(nodeId, behaviors, null)
    return
  }
  entry.behaviors = sanitizeBehaviorList(cloneBehaviorList(behaviors))
}

export function updateBehaviorObject(nodeId: string, object: Object3D | null): void {
  const entry = registry.get(nodeId)
  if (!entry) {
    return
  }
  entry.object = object
}

export function unregisterBehaviorComponent(nodeId: string): void {
  registry.delete(nodeId)
}

export function listInteractableObjects(): Object3D[] {
  const objects: Object3D[] = []
  registry.forEach((entry) => {
    if (entry.object) {
      objects.push(entry.object)
    }
  })
  return objects
}

function executeShowAlert(
  nodeId: string,
  behavior: SceneBehavior,
): BehaviorRuntimeEvent | null {
  const params = behavior.script.params as ShowAlertBehaviorParams | undefined
  if (!params) {
    return null
  }
  const sanitized: ShowAlertBehaviorParams = {
    title: params.title ?? '',
    message: params.message ?? '',
  }
  if (!sanitized.message) {
    sanitized.message = ' '
  }
  return {
    type: 'show-alert',
    nodeId,
    behaviorId: behavior.id,
    params: sanitized,
  }
}

function executeBehavior(
  nodeId: string,
  behavior: SceneBehavior,
  _context: BehaviorTriggerContext,
): BehaviorRuntimeEvent[] {
  switch (behavior.script.type) {
    case 'showAlert': {
      const result = executeShowAlert(nodeId, behavior)
      return result ? [result] : []
    }
    default:
      return []
  }
}

export function triggerBehaviorAction(
  nodeId: string,
  action: BehaviorActionType,
  context: BehaviorTriggerContext,
): BehaviorRuntimeEvent[] {
  const entry = registry.get(nodeId)
  if (!entry) {
    return []
  }
  const results: BehaviorRuntimeEvent[] = []
  entry.behaviors.forEach((behavior) => {
    if (behavior.action !== action) {
      return
    }
    const output = executeBehavior(nodeId, behavior, context)
    if (output.length) {
      results.push(...output)
    }
  })
  return results
}

export function hasRegisteredBehaviors(): boolean {
  for (const entry of registry.values()) {
    if (entry.behaviors.length > 0 && entry.object) {
      return true
    }
  }
  return false
}
