import type { Object3D } from 'three'
import type { SceneNode, SceneNodeComponentState } from '../../index'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import { ANIMATION_COMPONENT_TYPE } from './animationComponent'

export const CHARACTER_CONTROLLER_COMPONENT_TYPE = 'characterController'

export type CharacterAnimationSlot =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'turn'
  | 'jump'
  | 'fall'
  | 'strafe'
  | 'crouch'
  | 'interact'
  | 'death'

export type CharacterAnimationSlotOption = {
  label: string
  value: CharacterAnimationSlot
}

export const CHARACTER_ANIMATION_COMMON_SLOTS: CharacterAnimationSlotOption[] = [
  { label: 'Idle', value: 'idle' },
  { label: 'Walk', value: 'walk' },
  { label: 'Run', value: 'run' },
  { label: 'Sprint', value: 'sprint' },
  { label: 'Turn', value: 'turn' },
  { label: 'Jump', value: 'jump' },
  { label: 'Fall', value: 'fall' },
]

export const CHARACTER_ANIMATION_ADVANCED_SLOTS: CharacterAnimationSlotOption[] = [
  { label: 'Strafe', value: 'strafe' },
  { label: 'Crouch', value: 'crouch' },
  { label: 'Interact', value: 'interact' },
  { label: 'Death', value: 'death' },
]

export const CHARACTER_ANIMATION_EDITOR_SLOTS: CharacterAnimationSlotOption[] = [
  ...CHARACTER_ANIMATION_COMMON_SLOTS,
  ...CHARACTER_ANIMATION_ADVANCED_SLOTS,
]

export type CharacterForwardAxis = '+x' | '-x' | '+z' | '-z'

export interface CharacterAnimationBinding {
  slot: CharacterAnimationSlot
  clipName: string | null
}

export interface CharacterControllerComponentProps {
  label: string
  targetNodeId: string | null
  forwardAxis: CharacterForwardAxis
  cameraFollowDistance: number
  cameraFollowHeight: number
  walkSpeed: number
  runSpeed: number
  sprintSpeed: number
  turnRateDegreesPerSecond: number
  jumpImpulse: number
  airControl: number
  stepHeight: number
  slopeLimitDegrees: number
  colliderRadius: number
  colliderHeight: number
  animationBindings: CharacterAnimationBinding[]
}

export const CHARACTER_FORWARD_AXIS_OPTIONS: CharacterForwardAxis[] = ['+x', '-x', '+z', '-z']
export const DEFAULT_CHARACTER_FORWARD_AXIS: CharacterForwardAxis = '+x'
export const DEFAULT_CHARACTER_CAMERA_FOLLOW_DISTANCE = 6.1
export const DEFAULT_CHARACTER_CAMERA_FOLLOW_HEIGHT = 4.4

const DEFAULT_ANIMATION_SLOTS: CharacterAnimationSlot[] = CHARACTER_ANIMATION_EDITOR_SLOTS.map((slot) => slot.value)

function sanitizeString(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

function sanitizeNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(maximum, Math.max(minimum, numeric))
}

function sanitizeClipName(value: unknown): string | null {
  const trimmed = sanitizeString(value)
  return trimmed.length ? trimmed : null
}

function normalizeNodeId(value: unknown): string | null {
  const trimmed = sanitizeString(value)
  return trimmed.length ? trimmed : null
}

function hasAnimationComponent(node: SceneNode | null | undefined): boolean {
  return Boolean(node?.components?.[ANIMATION_COMPONENT_TYPE])
}

function resolveDefaultTargetNodeId(node: SceneNode | null | undefined): string | null {
  if (!node) {
    return null
  }
  if (hasAnimationComponent(node)) {
    return node.id
  }
  for (const child of node.children ?? []) {
    const resolved = resolveDefaultTargetNodeId(child)
    if (resolved) {
      return resolved
    }
  }
  return null
}

function normalizeForwardAxis(value: unknown): CharacterForwardAxis {
  return CHARACTER_FORWARD_AXIS_OPTIONS.includes(value as CharacterForwardAxis)
    ? (value as CharacterForwardAxis)
    : DEFAULT_CHARACTER_FORWARD_AXIS
}

function normalizeAnimationBinding(
  binding: Partial<CharacterAnimationBinding> | null | undefined,
  slot: CharacterAnimationSlot,
): CharacterAnimationBinding {
  return {
    slot,
    clipName: sanitizeClipName(binding?.clipName),
  }
}

function cloneAnimationBinding(binding: CharacterAnimationBinding): CharacterAnimationBinding {
  return {
    slot: binding.slot,
    clipName: binding.clipName,
  }
}

export function clampCharacterControllerComponentProps(
  props: Partial<CharacterControllerComponentProps> | null | undefined,
): CharacterControllerComponentProps {
  const sourceBindings = Array.isArray(props?.animationBindings) ? props.animationBindings : []
  const animationBindings = DEFAULT_ANIMATION_SLOTS.map((slot) => {
    const binding = sourceBindings.find((entry) => sanitizeString((entry as Partial<CharacterAnimationBinding> | null | undefined)?.slot) === slot)
    return normalizeAnimationBinding(binding as Partial<CharacterAnimationBinding> | null | undefined, slot)
  })
  return {
    label: sanitizeString(props?.label) || 'Character Controller',
    targetNodeId: normalizeNodeId(props?.targetNodeId),
    forwardAxis: normalizeForwardAxis(props?.forwardAxis),
    cameraFollowDistance: sanitizeNumber(props?.cameraFollowDistance, DEFAULT_CHARACTER_CAMERA_FOLLOW_DISTANCE, 0.1, 100),
    cameraFollowHeight: sanitizeNumber(props?.cameraFollowHeight, DEFAULT_CHARACTER_CAMERA_FOLLOW_HEIGHT, 0, 100),
    walkSpeed: sanitizeNumber(props?.walkSpeed, 2.4, 0, 100),
    runSpeed: sanitizeNumber(props?.runSpeed, 4.8, 0, 100),
    sprintSpeed: sanitizeNumber(props?.sprintSpeed, 6.4, 0, 100),
    turnRateDegreesPerSecond: sanitizeNumber(props?.turnRateDegreesPerSecond, 210, 0, 5000),
    jumpImpulse: sanitizeNumber(props?.jumpImpulse, 6.5, 0, 100),
    airControl: sanitizeNumber(props?.airControl, 0.35, 0, 1),
    stepHeight: sanitizeNumber(props?.stepHeight, 0.3, 0, 5),
    slopeLimitDegrees: sanitizeNumber(props?.slopeLimitDegrees, 50, 0, 89),
    colliderRadius: sanitizeNumber(props?.colliderRadius, 0.35, 0.05, 10),
    colliderHeight: sanitizeNumber(props?.colliderHeight, 1.7, 0.1, 20),
    animationBindings,
  }
}

export function cloneCharacterControllerComponentProps(
  props: CharacterControllerComponentProps,
): CharacterControllerComponentProps {
  return {
    label: props.label,
    targetNodeId: props.targetNodeId,
    forwardAxis: props.forwardAxis,
    cameraFollowDistance: props.cameraFollowDistance,
    cameraFollowHeight: props.cameraFollowHeight,
    walkSpeed: props.walkSpeed,
    runSpeed: props.runSpeed,
    sprintSpeed: props.sprintSpeed,
    turnRateDegreesPerSecond: props.turnRateDegreesPerSecond,
    jumpImpulse: props.jumpImpulse,
    airControl: props.airControl,
    stepHeight: props.stepHeight,
    slopeLimitDegrees: props.slopeLimitDegrees,
    colliderRadius: props.colliderRadius,
    colliderHeight: props.colliderHeight,
    animationBindings: props.animationBindings.map(cloneAnimationBinding),
  }
}

export function writeCharacterLocalForward(out: { set: (x: number, y: number, z: number) => unknown }, forwardAxis: CharacterForwardAxis): typeof out {
  switch (forwardAxis) {
    case '+x':
      out.set(1, 0, 0)
      break
    case '-x':
      out.set(-1, 0, 0)
      break
    case '+z':
      out.set(0, 0, 1)
      break
    case '-z':
      out.set(0, 0, -1)
      break
    default:
      out.set(1, 0, 0)
      break
  }
  return out
}

class CharacterControllerComponent extends Component<CharacterControllerComponentProps> {
  constructor(context: ComponentRuntimeContext<CharacterControllerComponentProps>) {
    super(context)
  }

  onRuntimeAttached(object: Object3D | null): void {
    if (!object) {
      return
    }
    object.userData.characterController = true
    object.userData.characterControllerComponentId = this.context.componentId
    object.userData.characterControllerNodeId = this.context.nodeId
  }
}

const characterControllerComponentDefinition: ComponentDefinition<CharacterControllerComponentProps> = {
  type: CHARACTER_CONTROLLER_COMPONENT_TYPE,
  label: 'Character Controller',
  icon: 'mdi-account-wrench-outline',
  order: 165,
  inspector: [],
  canAttach(node: SceneNode) {
    const nodeType = node.nodeType ?? ''
    return nodeType === 'Mesh' || nodeType === 'Group'
  },
  createDefaultProps(node: SceneNode) {
    return clampCharacterControllerComponentProps({
      label: node.name?.trim().length ? node.name : 'Character Controller',
      targetNodeId: resolveDefaultTargetNodeId(node),
    })
  },
  createInstance(context) {
    return new CharacterControllerComponent(context)
  },
}

componentManager.registerDefinition(characterControllerComponentDefinition)

export function createCharacterControllerComponentState(
  node: SceneNode,
  overrides?: Partial<CharacterControllerComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<CharacterControllerComponentProps> {
  const defaults = characterControllerComponentDefinition.createDefaultProps(node)
  const merged = clampCharacterControllerComponentProps({
    ...defaults,
    ...overrides,
  })
  return {
    id: options.id ?? '',
    type: CHARACTER_CONTROLLER_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { characterControllerComponentDefinition }
