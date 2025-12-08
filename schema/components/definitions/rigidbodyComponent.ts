import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const RIGIDBODY_COMPONENT_TYPE = 'rigidbody'
export type RigidbodyBodyType = 'DYNAMIC' | 'STATIC' | 'KINEMATIC'
export type RigidbodyColliderType = 'box' | 'convex'

export interface RigidbodyComponentProps {
  mass: number
  bodyType: RigidbodyBodyType
  colliderType: RigidbodyColliderType
  linearDamping: number
  angularDamping: number
  restitution: number
  friction: number
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

export const DEFAULT_RIGIDBODY_MASS = 10000
export const DEFAULT_RIGIDBODY_BODY_TYPE: RigidbodyBodyType = 'DYNAMIC'
export const DEFAULT_RIGIDBODY_COLLIDER_TYPE: RigidbodyColliderType = 'convex'
export const MIN_RIGIDBODY_MASS = 0
export const MAX_RIGIDBODY_MASS = 100000
export const DEFAULT_LINEAR_DAMPING = 0.01
export const DEFAULT_ANGULAR_DAMPING = 0.4
export const DEFAULT_RIGIDBODY_RESTITUTION = 0.2
export const DEFAULT_RIGIDBODY_FRICTION = 0.5

export function clampRigidbodyComponentProps(
  props: Partial<RigidbodyComponentProps> | null | undefined,
): RigidbodyComponentProps {
  const rawMass = typeof props?.mass === 'number' && Number.isFinite(props.mass) ? props.mass : DEFAULT_RIGIDBODY_MASS
  const normalizedMass = Math.min(MAX_RIGIDBODY_MASS, Math.max(MIN_RIGIDBODY_MASS, rawMass))
  const normalizedType: RigidbodyBodyType = props?.bodyType === 'STATIC' || props?.bodyType === 'KINEMATIC'
    ? props.bodyType
    : DEFAULT_RIGIDBODY_BODY_TYPE
  const normalizedColliderType: RigidbodyColliderType = props?.colliderType === 'box' || props?.colliderType === 'convex'
    ? props.colliderType
    : DEFAULT_RIGIDBODY_COLLIDER_TYPE
  
  const rawLinearDamping = typeof props?.linearDamping === 'number' && Number.isFinite(props.linearDamping) ? props.linearDamping : DEFAULT_LINEAR_DAMPING
  const normalizedLinearDamping = Math.max(0, Math.min(1, rawLinearDamping))

  const rawAngularDamping = typeof props?.angularDamping === 'number' && Number.isFinite(props.angularDamping) ? props.angularDamping : DEFAULT_ANGULAR_DAMPING
  const normalizedAngularDamping = Math.max(0, Math.min(1, rawAngularDamping))

  const rawRestitution = typeof props?.restitution === 'number' && Number.isFinite(props.restitution)
    ? props.restitution
    : DEFAULT_RIGIDBODY_RESTITUTION
  const normalizedRestitution = Math.max(0, Math.min(1, rawRestitution))

  const rawFriction = typeof props?.friction === 'number' && Number.isFinite(props.friction)
    ? props.friction
    : DEFAULT_RIGIDBODY_FRICTION
  const normalizedFriction = Math.max(0, Math.min(1, rawFriction))

  let normalizedTargetNodeId: string | null = null
  if (typeof props?.targetNodeId === 'string') {
    const trimmed = props.targetNodeId.trim()
    normalizedTargetNodeId = trimmed.length ? trimmed : null
  } else if (props?.targetNodeId === null) {
    normalizedTargetNodeId = null
  }

  return {
    mass: normalizedMass,
    bodyType: normalizedType,
    colliderType: normalizedColliderType,
    linearDamping: normalizedLinearDamping,
    angularDamping: normalizedAngularDamping,
    restitution: normalizedRestitution,
    friction: normalizedFriction,
    targetNodeId: normalizedTargetNodeId,
  }
}

export function cloneRigidbodyComponentProps(props: RigidbodyComponentProps): RigidbodyComponentProps {
  return {
    mass: props.mass,
    bodyType: props.bodyType,
    colliderType: props.colliderType,
    linearDamping: props.linearDamping,
    angularDamping: props.angularDamping,
    restitution: props.restitution,
    friction: props.friction,
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
