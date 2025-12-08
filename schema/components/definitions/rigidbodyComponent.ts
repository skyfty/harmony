import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const RIGIDBODY_COMPONENT_TYPE = 'rigidbody'

export interface RigidbodyComponentProps {
  mass: number
  targetNodeId: string | null
}

export type RigidbodyVector3Tuple = [number, number, number]

export type RigidbodyPhysicsShape =
  | {
      kind: 'box'
      halfExtents: RigidbodyVector3Tuple
      offset?: RigidbodyVector3Tuple
    }
  | {
      kind: 'convex'
      vertices: RigidbodyVector3Tuple[]
      faces: number[][]
      offset?: RigidbodyVector3Tuple
    }
  | {
      kind: 'heightfield'
      matrix: number[][]
      elementSize: number
      width: number
      depth: number
      offset?: RigidbodyVector3Tuple
    }

export const RIGIDBODY_METADATA_KEY = '__harmonyRigidbody'

export interface RigidbodyComponentMetadata {
  shape?: RigidbodyPhysicsShape | null
  generatedAt?: string
}

export const DEFAULT_RIGIDBODY_MASS = 1
export const MIN_RIGIDBODY_MASS = 0
export const MAX_RIGIDBODY_MASS = 10_000

export function clampRigidbodyComponentProps(
  props: Partial<RigidbodyComponentProps> | null | undefined,
): RigidbodyComponentProps {
  const rawMass = typeof props?.mass === 'number' && Number.isFinite(props.mass) ? props.mass : DEFAULT_RIGIDBODY_MASS
  const normalizedMass = Math.min(MAX_RIGIDBODY_MASS, Math.max(MIN_RIGIDBODY_MASS, rawMass))
  let normalizedTargetNodeId: string | null = null
  if (typeof props?.targetNodeId === 'string') {
    const trimmed = props.targetNodeId.trim()
    normalizedTargetNodeId = trimmed.length ? trimmed : null
  } else if (props?.targetNodeId === null) {
    normalizedTargetNodeId = null
  }
  return {
    mass: normalizedMass,
    targetNodeId: normalizedTargetNodeId,
  }
}

export function cloneRigidbodyComponentProps(props: RigidbodyComponentProps): RigidbodyComponentProps {
  return {
    mass: props.mass,
    targetNodeId: props.targetNodeId ?? null,
  }
}

class RigidbodyComponent extends Component<RigidbodyComponentProps> {
  constructor(context: ComponentRuntimeContext<RigidbodyComponentProps>) {
    super(context)
  }
}

const rigidbodyComponentDefinition: ComponentDefinition<RigidbodyComponentProps> = {
  type: RIGIDBODY_COMPONENT_TYPE,
  label: 'Rigidbody',
  icon: 'mdi-cube-scan',
  order: 150,
  inspector: [],
  canAttach(node: SceneNode) {
    const nodeType = node.nodeType?.toLowerCase?.() ?? ''
    if (nodeType === 'light' || nodeType === 'sky' || nodeType === 'environment') {
      return false
    }
    return true
  },
  createDefaultProps(node: SceneNode) {
    return clampRigidbodyComponentProps({
      targetNodeId: node.id ?? null,
    })
  },
  createInstance(context) {
    return new RigidbodyComponent(context)
  },
}

componentManager.registerDefinition(rigidbodyComponentDefinition)

export function createRigidbodyComponentState(
  node: SceneNode,
  overrides?: Partial<RigidbodyComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<RigidbodyComponentProps> {
  const defaults = rigidbodyComponentDefinition.createDefaultProps(node)
  const props = clampRigidbodyComponentProps({
    ...defaults,
    ...overrides,
  })
  return {
    id: options.id ?? '',
    type: RIGIDBODY_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props,
  }
}

export { rigidbodyComponentDefinition }
