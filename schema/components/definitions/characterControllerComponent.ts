import type { Object3D } from 'three'
import type { SceneNode, SceneNodeComponentState } from '../../index'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'

export const CHARACTER_CONTROLLER_COMPONENT_TYPE = 'characterController'

export type CharacterAnimationSlot =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'turnLeft'
  | 'turnRight'
  | 'jumpStart'
  | 'jumpLoop'
  | 'jumpLand'
  | 'fall'
  | 'strafeLeft'
  | 'strafeRight'
  | 'crouchIdle'
  | 'crouchWalk'
  | 'interact'
  | 'death'

export interface CharacterAnimationBinding {
  slot: CharacterAnimationSlot
  clipName: string | null
}

export interface CharacterControllerComponentProps {
  label: string
  enabledByDefault: boolean
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

const DEFAULT_ANIMATION_SLOTS: CharacterAnimationSlot[] = [
  'idle',
  'walk',
  'run',
  'sprint',
  'turnLeft',
  'turnRight',
  'jumpStart',
  'jumpLoop',
  'jumpLand',
  'fall',
  'strafeLeft',
  'strafeRight',
  'crouchIdle',
  'crouchWalk',
  'interact',
  'death',
]

function sanitizeString(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function sanitizeNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(maximum, Math.max(minimum, numeric))
}

function sanitizeClipName(value: unknown): string | null {
  const trimmed = sanitizeString(value)
  return trimmed.length ? trimmed : null
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
  const bindings = new Map<CharacterAnimationSlot, CharacterAnimationBinding>()
  const sourceBindings = Array.isArray(props?.animationBindings) ? props.animationBindings : []
  sourceBindings.forEach((binding) => {
    const slot = sanitizeString((binding as Partial<CharacterAnimationBinding> | null | undefined)?.slot)
    if (!slot || !DEFAULT_ANIMATION_SLOTS.includes(slot as CharacterAnimationSlot)) {
      return
    }
    bindings.set(slot as CharacterAnimationSlot, normalizeAnimationBinding(binding as Partial<CharacterAnimationBinding>, slot as CharacterAnimationSlot))
  })
  const animationBindings = DEFAULT_ANIMATION_SLOTS.map((slot) => bindings.get(slot) ?? normalizeAnimationBinding(null, slot))
  return {
    label: sanitizeString(props?.label) || 'Character Controller',
    enabledByDefault: sanitizeBoolean(props?.enabledByDefault, true),
    walkSpeed: sanitizeNumber(props?.walkSpeed, 2.4, 0, 100),
    runSpeed: sanitizeNumber(props?.runSpeed, 4.8, 0, 100),
    sprintSpeed: sanitizeNumber(props?.sprintSpeed, 6.4, 0, 100),
    turnRateDegreesPerSecond: sanitizeNumber(props?.turnRateDegreesPerSecond, 540, 0, 5000),
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
    enabledByDefault: props.enabledByDefault,
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

class CharacterControllerComponent extends Component<CharacterControllerComponentProps> {
  constructor(context: ComponentRuntimeContext<CharacterControllerComponentProps>) {
    super(context)
  }

  onRuntimeAttached(object: Object3D | null): void {
    if (!object) {
      return
    }
    object.userData.protagonist = true
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
    const hasSourceAsset = typeof node.sourceAssetId === 'string' && node.sourceAssetId.trim().length > 0
    return hasSourceAsset && (nodeType === 'Mesh' || nodeType === 'Group')
  },
  createDefaultProps(node: SceneNode) {
    return clampCharacterControllerComponentProps({
      label: node.name?.trim().length ? node.name : 'Character Controller',
      enabledByDefault: true,
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
