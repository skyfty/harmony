import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode } from '../../index'
import { CHARACTER_CONTROLLER_COMPONENT_TYPE } from './characterControllerComponent'
import { VEHICLE_COMPONENT_TYPE } from './vehicleComponent'
import { CONTROLLABLE_TARGET_TYPES, type SteerControllableTargetType } from '../../controllableTargetTypes'

export const STEER_COMPONENT_TYPE = 'steer'

export const STEER_TARGET_TYPES = CONTROLLABLE_TARGET_TYPES
export type { SteerControllableTargetType }

export interface SteerComponentProps {
  targetNodeId: string | null
  targetType: SteerControllableTargetType
  defaultIdentifier: string | null
  autoEnterOnSceneLoad: boolean
}

export const DEFAULT_STEER_TARGET_TYPE: SteerControllableTargetType = 'vehicle'
export const DEFAULT_STEER_AUTO_ENTER_ON_SCENE_LOAD = true

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function normalizeTargetType(value: unknown): SteerControllableTargetType {
  return STEER_TARGET_TYPES.includes(value as SteerControllableTargetType)
    ? (value as SteerControllableTargetType)
    : DEFAULT_STEER_TARGET_TYPE
}

function hasEnabledComponent(node: SceneNode | null | undefined, type: string): boolean {
  const component = node?.components?.[type]
  return Boolean(component && component.enabled !== false)
}

export function clampSteerComponentProps(props: Partial<SteerComponentProps> | null | undefined): SteerComponentProps {
  return {
    targetNodeId: normalizeString(props?.targetNodeId),
    targetType: normalizeTargetType(props?.targetType),
    defaultIdentifier: normalizeString(props?.defaultIdentifier),
    autoEnterOnSceneLoad: props?.autoEnterOnSceneLoad !== false,
  }
}

export function isSteerTargetNode(
  node: SceneNode | null | undefined,
  targetType: SteerControllableTargetType | null | undefined,
): boolean {
  if (!node) {
    return false
  }
  if (targetType === 'character') {
    return hasEnabledComponent(node, CHARACTER_CONTROLLER_COMPONENT_TYPE)
  }
  return hasEnabledComponent(node, VEHICLE_COMPONENT_TYPE)
}

export function isAnySteerTargetNode(node: SceneNode | null | undefined): boolean {
  if (!node) {
    return false
  }
  return isSteerTargetNode(node, 'character') || isSteerTargetNode(node, 'vehicle')
}

export function inferSteerTargetTypeFromNode(
  node: SceneNode | null | undefined,
): SteerControllableTargetType | null {
  if (!node) {
    return null
  }
  if (hasEnabledComponent(node, CHARACTER_CONTROLLER_COMPONENT_TYPE)) {
    return 'character'
  }
  if (hasEnabledComponent(node, VEHICLE_COMPONENT_TYPE)) {
    return 'vehicle'
  }
  return null
}

export function inferSteerTargetTypeFromNodeId(
  nodes: SceneNode[] | null | undefined,
  nodeId: string | null | undefined,
): SteerControllableTargetType | null {
  if (!nodes?.length || !nodeId) {
    return null
  }
  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (node.id === nodeId) {
      return inferSteerTargetTypeFromNode(node)
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
  }
  return null
}

class SteerComponent extends Component<SteerComponentProps> {
  constructor(context: ComponentRuntimeContext<SteerComponentProps>) {
    super(context)
  }
}

const steerComponentDefinition: ComponentDefinition<SteerComponentProps> = {
  type: STEER_COMPONENT_TYPE,
  label: 'Steer',
  icon: 'mdi-steering',
  order: 156,
  inspector: [
    {
      id: 'steer-target',
      label: 'Target',
      fields: [
        {
          kind: 'select',
          key: 'targetType',
          label: 'Target Type',
          options: STEER_TARGET_TYPES.map((value) => ({
            label: value,
            value,
          })),
        },
        {
          kind: 'text',
          key: 'targetNodeId',
          label: 'Target Node Id',
          placeholder: 'Select controllable node',
        },
        {
          kind: 'text',
          key: 'defaultIdentifier',
          label: 'Default Identifier',
          placeholder: 'vehicleIdentifier / future steer key',
        },
        {
          kind: 'boolean',
          key: 'autoEnterOnSceneLoad',
          label: 'Auto Enter On Scene Load',
        },
      ],
    },
  ],
  canAttach(_node: SceneNode): boolean {
    return true
  },
  createDefaultProps(): SteerComponentProps {
    return clampSteerComponentProps(null)
  },
  createInstance(context: ComponentRuntimeContext<SteerComponentProps>): Component<SteerComponentProps> {
    return new SteerComponent(context)
  },
}

componentManager.registerDefinition(steerComponentDefinition)

export { steerComponentDefinition }
