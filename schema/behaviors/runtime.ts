import type { Object3D } from 'three'
import type {
  BehaviorEventType,
  DelayBehaviorParams,
  HideBehaviorParams,
  LanternBehaviorParams,
  MoveToBehaviorParams,
  MoveToFacingDirection,
  SceneBehavior,
  SceneBehaviorMap,
  ShowAlertBehaviorParams,
  ShowBehaviorParams,
  WatchBehaviorParams,
} from '../index'
import { behaviorMapToList, cloneBehaviorList, ensureBehaviorParams } from './definitions'

export type BehaviorTriggerContext = {
  pointerEvent?: PointerEvent | MouseEvent | TouchEvent
  intersection?: {
    object: Object3D
    point: { x: number; y: number; z: number }
  }
  payload?: Record<string, unknown>
}

export type BehaviorSequenceStatus = 'success' | 'failure' | 'aborted'

export const PROXIMITY_MIN_DISTANCE = 3
export const PROXIMITY_RADIUS_SCALE = 1.25
export const PROXIMITY_EXIT_PADDING = 0.75
export const DEFAULT_OBJECT_RADIUS = 1.2

export type BehaviorRuntimeEvent =
  | {
      type: 'delay'
      nodeId: string
      action: BehaviorEventType
      sequenceId: string
      behaviorSequenceId: string
      behaviorId: string
      seconds: number
      token: string
    }
  | {
      type: 'move-camera'
      nodeId: string
      action: BehaviorEventType
      sequenceId: string
      behaviorSequenceId: string
      behaviorId: string
      speed: number
      facing: MoveToFacingDirection
      offset: number
      token: string
    }
  | {
      type: 'show-alert'
      nodeId: string
      action: BehaviorEventType
      sequenceId: string
      behaviorSequenceId: string
      behaviorId: string
      params: ShowAlertBehaviorParams
      token: string
    }
  | {
      type: 'watch-node'
      nodeId: string
      action: BehaviorEventType
      sequenceId: string
      behaviorSequenceId: string
      behaviorId: string
      targetNodeId: string | null
      token: string
    }
  | {
      type: 'lantern'
      nodeId: string
      action: BehaviorEventType
      sequenceId: string
      behaviorSequenceId: string
      behaviorId: string
      params: LanternBehaviorParams
      token: string
    }
  | {
      type: 'set-visibility'
      nodeId: string
      action: BehaviorEventType
      sequenceId: string
      behaviorSequenceId: string
      behaviorId: string
      targetNodeId: string
      visible: boolean
    }
  | {
      type: 'look-level'
      nodeId: string
      action: BehaviorEventType
      sequenceId: string
      behaviorSequenceId: string
      behaviorId: string
      token: string
    }
  | {
      type: 'sequence-complete'
      nodeId: string
      action: BehaviorEventType
      sequenceId: string
      behaviorSequenceId: string
      behaviorId: string | null
      status: BehaviorSequenceStatus
      message?: string
    }
  | {
      type: 'sequence-error'
      nodeId: string
      action: BehaviorEventType
      sequenceId: string
      behaviorSequenceId: string
      behaviorId: string | null
      message: string
    }

export type BehaviorEventResolution =
  | { type: 'continue' }
  | { type: 'abort'; message?: string }
  | { type: 'fail'; message?: string }

type BehaviorSequenceGroup = {
  sequenceId: string
  steps: SceneBehavior[]
}

type BehaviorRegistry = Partial<Record<BehaviorEventType, BehaviorSequenceGroup[]>>

type RegistryEntry = {
  nodeId: string
  behaviors: BehaviorRegistry
  object: Object3D | null
}

type BehaviorSequenceState = {
  id: string
  nodeId: string
  action: BehaviorEventType
  behaviorSequenceId: string
  steps: SceneBehavior[]
  index: number
  status: 'running' | 'waiting' | 'done'
}

type PendingTokenState = {
  token: string
  sequenceId: string
  stepIndex: number
}

const registry = new Map<string, RegistryEntry>()
const sequences = new Map<string, BehaviorSequenceState>()
const pendingTokens = new Map<string, PendingTokenState>()

let sequenceCounter = 0
let tokenCounter = 0

export type BehaviorRuntimeListener = {
  onRegistryChanged?: (nodeId: string) => void
}

const runtimeListeners = new Set<BehaviorRuntimeListener>()

function notifyRegistryChanged(nodeId: string): void {
  runtimeListeners.forEach((listener) => {
    try {
      listener.onRegistryChanged?.(nodeId)
    } catch {
      /* ignore listener errors */
    }
  })
}

export function addBehaviorRuntimeListener(listener: BehaviorRuntimeListener): void {
  runtimeListeners.add(listener)
}

export function removeBehaviorRuntimeListener(listener: BehaviorRuntimeListener): void {
  runtimeListeners.delete(listener)
}

type BehaviorCollection = SceneBehavior[] | SceneBehaviorMap | null | undefined

function toBehaviorList(input: BehaviorCollection): SceneBehavior[] {
  if (Array.isArray(input)) {
    return input
  }
  if (input && typeof input === 'object') {
    return behaviorMapToList(input)
  }
  return []
}

function buildBehaviorRegistry(list: SceneBehavior[] | null | undefined): BehaviorRegistry {
  if (!Array.isArray(list) || !list.length) {
    return {}
  }
  const registry: BehaviorRegistry = {}
  cloneBehaviorList(list).forEach((behavior) => {
    if (!behavior) {
      return
    }
    const action = behavior.action
    const sequenceId = behavior.sequenceId
    const groups = registry[action] ?? (registry[action] = [])
    let group = groups.find((entry) => entry.sequenceId === sequenceId)
    if (!group) {
      if (action !== 'perform' && groups.length) {
        const primary = groups[0]!
        primary.sequenceId = sequenceId
        primary.steps = []
        group = primary
      } else {
        group = { sequenceId, steps: [] }
        groups.push(group)
      }
    }
    if (!group) {
      return
    }
    group.steps.push({
      id: behavior.id,
      name: behavior.name,
      action,
      sequenceId,
      script: ensureBehaviorParams(behavior.script),
    })
  })
  ;(Object.keys(registry) as BehaviorEventType[]).forEach((action) => {
    const groups = registry[action]
    if (!groups) {
      delete registry[action]
      return
    }
    const nonEmpty = groups.filter((group) => group.steps.length)
    if (nonEmpty.length) {
      registry[action] = nonEmpty
    } else {
      delete registry[action]
    }
  })
  return registry
}

function createSequenceId(): string {
  sequenceCounter += 1
  return `seq_${Date.now()}_${sequenceCounter}`
}

function createToken(sequenceId: string, stepIndex: number): string {
  tokenCounter += 1
  return `tok_${sequenceId}_${stepIndex}_${tokenCounter}`
}

function cleanupPendingTokens(sequenceId: string): void {
  const toDelete: string[] = []
  pendingTokens.forEach((entry, key) => {
    if (entry.sequenceId === sequenceId) {
      toDelete.push(key)
    }
  })
  toDelete.forEach((key) => pendingTokens.delete(key))
}

function finalizeSequence(
  state: BehaviorSequenceState,
  status: BehaviorSequenceStatus,
  behaviorId: string | null,
  message?: string,
): BehaviorRuntimeEvent {
  state.status = 'done'
  sequences.delete(state.id)
  cleanupPendingTokens(state.id)
  return {
    type: 'sequence-complete',
    nodeId: state.nodeId,
    action: state.action,
    sequenceId: state.id,
    behaviorSequenceId: state.behaviorSequenceId,
    behaviorId,
    status,
    message,
  }
}

function registerBehaviorSequence(
  nodeId: string,
  action: BehaviorEventType,
  behaviorSequenceId: string,
  steps: SceneBehavior[],
): BehaviorSequenceState {
  const sequence: BehaviorSequenceState = {
    id: createSequenceId(),
    nodeId,
    action,
    behaviorSequenceId,
    steps,
    index: 0,
    status: 'running',
  }
  sequences.set(sequence.id, sequence)
  return sequence
}

function createDelayEvent(state: BehaviorSequenceState, behavior: SceneBehavior): BehaviorRuntimeEvent {
  const token = createToken(state.id, state.index)
  pendingTokens.set(token, {
    token,
    sequenceId: state.id,
    stepIndex: state.index,
  })
  state.status = 'waiting'
  const params = behavior.script.params as DelayBehaviorParams
  return {
    type: 'delay',
    nodeId: state.nodeId,
    action: state.action,
    sequenceId: state.id,
    behaviorSequenceId: state.behaviorSequenceId,
    behaviorId: behavior.id,
    seconds: Math.max(0, params.seconds ?? 0),
    token,
  }
}

function createMoveCameraEvent(state: BehaviorSequenceState, behavior: SceneBehavior): BehaviorRuntimeEvent {
  const token = createToken(state.id, state.index)
  pendingTokens.set(token, {
    token,
    sequenceId: state.id,
    stepIndex: state.index,
  })
  state.status = 'waiting'
  const params = behavior.script.params as MoveToBehaviorParams
  return {
    type: 'move-camera',
    nodeId: state.nodeId,
    action: state.action,
    sequenceId: state.id,
    behaviorSequenceId: state.behaviorSequenceId,
    behaviorId: behavior.id,
    speed: Math.max(0, params.speed ?? 0),
    facing: params.facing ?? 'front',
    offset: Math.max(0, params.offset ?? 0),
    token,
  }
}

function createShowAlertEvent(state: BehaviorSequenceState, behavior: SceneBehavior): BehaviorRuntimeEvent {
  const token = createToken(state.id, state.index)
  pendingTokens.set(token, {
    token,
    sequenceId: state.id,
    stepIndex: state.index,
  })
  state.status = 'waiting'
  const params = behavior.script.params as ShowAlertBehaviorParams
  return {
    type: 'show-alert',
    nodeId: state.nodeId,
    action: state.action,
    sequenceId: state.id,
    behaviorSequenceId: state.behaviorSequenceId,
    behaviorId: behavior.id,
    params,
    token,
  }
}

function createLanternEvent(state: BehaviorSequenceState, behavior: SceneBehavior): BehaviorRuntimeEvent {
  const token = createToken(state.id, state.index)
  pendingTokens.set(token, {
    token,
    sequenceId: state.id,
    stepIndex: state.index,
  })
  state.status = 'waiting'
  const params = behavior.script.params as LanternBehaviorParams
  return {
    type: 'lantern',
    nodeId: state.nodeId,
    action: state.action,
    sequenceId: state.id,
    behaviorSequenceId: state.behaviorSequenceId,
    behaviorId: behavior.id,
    params,
    token,
  }
}

function createWatchEvent(state: BehaviorSequenceState, behavior: SceneBehavior): BehaviorRuntimeEvent {
  const token = createToken(state.id, state.index)
  pendingTokens.set(token, {
    token,
    sequenceId: state.id,
    stepIndex: state.index,
  })
  state.status = 'waiting'
  const params = behavior.script.params as WatchBehaviorParams
  return {
    type: 'watch-node',
    nodeId: state.nodeId,
    action: state.action,
    sequenceId: state.id,
    behaviorSequenceId: state.behaviorSequenceId,
    behaviorId: behavior.id,
    targetNodeId: params.targetNodeId ?? state.nodeId,
    token,
  }
}

function createLookEvent(state: BehaviorSequenceState, behavior: SceneBehavior): BehaviorRuntimeEvent {
  const token = createToken(state.id, state.index)
  pendingTokens.set(token, {
    token,
    sequenceId: state.id,
    stepIndex: state.index,
  })
  state.status = 'waiting'
  return {
    type: 'look-level',
    nodeId: state.nodeId,
    action: state.action,
    sequenceId: state.id,
    behaviorSequenceId: state.behaviorSequenceId,
    behaviorId: behavior.id,
    token,
  }
}

function createVisibilityEvent(
  state: BehaviorSequenceState,
  behavior: SceneBehavior,
  params: ShowBehaviorParams | HideBehaviorParams,
  visible: boolean,
): BehaviorRuntimeEvent {
  const fallbackTarget = state.nodeId
  const targetNodeId = params?.targetNodeId && params.targetNodeId.trim() ? params.targetNodeId : fallbackTarget
  return {
    type: 'set-visibility',
    nodeId: state.nodeId,
    action: state.action,
    sequenceId: state.id,
    behaviorSequenceId: state.behaviorSequenceId,
    behaviorId: behavior.id,
    targetNodeId,
    visible,
  }
}

function advanceSequence(state: BehaviorSequenceState): BehaviorRuntimeEvent[] {
  const events: BehaviorRuntimeEvent[] = []
  while (state.status === 'running' && state.index < state.steps.length) {
    const behavior = state.steps[state.index]
    if (!behavior) {
      events.push({
        type: 'sequence-error',
        nodeId: state.nodeId,
        action: state.action,
        sequenceId: state.id,
        behaviorSequenceId: state.behaviorSequenceId,
        behaviorId: null,
        message: 'Encountered missing behavior step.',
      })
      events.push(finalizeSequence(state, 'failure', null, 'Missing behavior step'))
      return events
    }
    const { script } = behavior
    switch (script.type) {
      case 'delay':
        events.push(createDelayEvent(state, behavior))
        return events
      case 'moveTo':
        events.push(createMoveCameraEvent(state, behavior))
        return events
      case 'showAlert':
        events.push(createShowAlertEvent(state, behavior))
        return events
      case 'lantern':
        events.push(createLanternEvent(state, behavior))
        return events
      case 'watch':
        events.push(createWatchEvent(state, behavior))
        return events
      case 'show': {
        const params = script.params as ShowBehaviorParams
        events.push(createVisibilityEvent(state, behavior, params, true))
        state.index += 1
        continue
      }
      case 'hide': {
        const params = script.params as HideBehaviorParams
        events.push(createVisibilityEvent(state, behavior, params, false))
        state.index += 1
        continue
      }
      case 'look':
        events.push(createLookEvent(state, behavior))
        return events
      default:
        break
    }
    state.index += 1
  }
  if (state.status === 'running') {
    events.push(finalizeSequence(state, 'success', null))
  }
  return events
}

function cancelSequencesForNode(nodeId: string): void {
  const affected = Array.from(sequences.values()).filter((sequence) => sequence.nodeId === nodeId)
  affected.forEach((sequence) => {
    const event = finalizeSequence(sequence, 'aborted', null, 'Behavior component updated')
    // No consumer is currently subscribed to these implicit cancellations, so we discard the event.
    void event
  })
}

export function resetBehaviorRuntime(): void {
  registry.clear()
  sequences.clear()
  pendingTokens.clear()
}

export function registerBehaviorComponent(
  nodeId: string,
  behaviors: BehaviorCollection = [],
  object: Object3D | null,
): void {
  cancelSequencesForNode(nodeId)
  registry.set(nodeId, {
    nodeId,
    behaviors: buildBehaviorRegistry(toBehaviorList(behaviors)),
    object,
  })
  notifyRegistryChanged(nodeId)
}

export function updateBehaviorComponent(nodeId: string, behaviors: BehaviorCollection): void {
  const entry = registry.get(nodeId)
  if (!entry) {
    registerBehaviorComponent(nodeId, behaviors, null)
    return
  }
  cancelSequencesForNode(nodeId)
  entry.behaviors = buildBehaviorRegistry(toBehaviorList(behaviors))
  notifyRegistryChanged(nodeId)
}

export function updateBehaviorObject(nodeId: string, object: Object3D | null): void {
  const entry = registry.get(nodeId)
  if (!entry) {
    return
  }
  entry.object = object
}

export function unregisterBehaviorComponent(nodeId: string): void {
  cancelSequencesForNode(nodeId)
  registry.delete(nodeId)
  notifyRegistryChanged(nodeId)
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

export function listRegisteredBehaviorActions(nodeId: string): BehaviorEventType[] {
  const entry = registry.get(nodeId)
  if (!entry) {
    return []
  }
  const actions: BehaviorEventType[] = []
  ;(Object.keys(entry.behaviors) as BehaviorEventType[]).forEach((action) => {
    const groups = entry.behaviors[action]
    if (groups?.some((group) => group.steps.length > 0)) {
      actions.push(action)
    }
  })
  return actions
}

export function triggerBehaviorAction(
  nodeId: string,
  action: BehaviorEventType,
  _context: BehaviorTriggerContext,
  options: { sequenceId?: string } = {},
): BehaviorRuntimeEvent[] {
  const entry = registry.get(nodeId)
  if (!entry) {
    return []
  }
  const groups = entry.behaviors[action]
  if (!groups || !groups.length) {
    return []
  }
  const targetSequence = options.sequenceId
    ? groups.find((group) => group.sequenceId === options.sequenceId)
    : groups[0]
  if (!targetSequence || !targetSequence.steps.length) {
    return []
  }
  const sequence = registerBehaviorSequence(
    nodeId,
    action,
    targetSequence.sequenceId,
    cloneBehaviorList(targetSequence.steps),
  )
  return advanceSequence(sequence)
}

export function resolveBehaviorEvent(token: string, resolution: BehaviorEventResolution): BehaviorRuntimeEvent[] {
  const pending = pendingTokens.get(token)
  if (!pending) {
    return []
  }
  pendingTokens.delete(token)
  const state = sequences.get(pending.sequenceId)
  if (!state || state.status !== 'waiting' || state.index !== pending.stepIndex) {
    return []
  }
  const currentBehavior = state.steps[state.index]
  if (!currentBehavior) {
    return []
  }
  if (resolution.type === 'abort') {
    return [finalizeSequence(state, 'aborted', currentBehavior.id || null, resolution.message)]
  }
  if (resolution.type === 'fail') {
    return [finalizeSequence(state, 'failure', currentBehavior.id || null, resolution.message)]
  }
  state.status = 'running'
  state.index += 1
  return advanceSequence(state)
}

export function hasRegisteredBehaviors(): boolean {
  for (const entry of registry.values()) {
    const hasBehaviors = Object.values(entry.behaviors).some((groups) =>
      groups?.some((group) => group.steps.length > 0),
    )
    if (hasBehaviors && entry.object) {
      return true
    }
  }
  return false
}
