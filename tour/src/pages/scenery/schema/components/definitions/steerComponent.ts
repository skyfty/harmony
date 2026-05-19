import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode } from '../../index'

export const STEER_COMPONENT_TYPE = 'steer'

export const STEER_TARGET_TYPES = ['vehicle', 'ship', 'aircraft', 'character'] as const

export type SteerControllableTargetType = (typeof STEER_TARGET_TYPES)[number]

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

export function clampSteerComponentProps(props: Partial<SteerComponentProps> | null | undefined): SteerComponentProps {
  return {
    targetNodeId: normalizeString(props?.targetNodeId),
    targetType: normalizeTargetType(props?.targetType),
    defaultIdentifier: normalizeString(props?.defaultIdentifier),
    autoEnterOnSceneLoad: props?.autoEnterOnSceneLoad !== false,
  }
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