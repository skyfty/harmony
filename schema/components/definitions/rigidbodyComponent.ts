import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const RIGIDBODY_COMPONENT_TYPE = 'rigidbody'
export type RigidbodyBodyType = 'DYNAMIC' | 'STATIC' | 'KINEMATIC'
export type RigidbodyColliderType = 'box' | 'convex' | 'sphere' | 'cylinder' | 'capsule'
export type RigidbodyConvexDecompositionLevel = 'default' | 'fine' | 'coarse'

const VALID_RIGIDBODY_COLLIDER_TYPES: readonly RigidbodyColliderType[] = [
  'box',
  'convex',
  'sphere',
  'cylinder',
  'capsule',
] as const

const VALID_RIGIDBODY_CONVEX_DECOMPOSITION_LEVELS: readonly RigidbodyConvexDecompositionLevel[] = [
  'default',
  'fine',
  'coarse',
] as const

function isRigidbodyColliderType(value: unknown): value is RigidbodyColliderType {
  return typeof value === 'string' && (VALID_RIGIDBODY_COLLIDER_TYPES as readonly string[]).includes(value)
}

function isRigidbodyConvexDecompositionLevel(value: unknown): value is RigidbodyConvexDecompositionLevel {
  return typeof value === 'string'
    && (VALID_RIGIDBODY_CONVEX_DECOMPOSITION_LEVELS as readonly string[]).includes(value)
}

export interface RigidbodyComponentProps {
  mass: number
  bodyType: RigidbodyBodyType
  colliderType: RigidbodyColliderType
  linearDamping: number
  angularDamping: number
  restitution: number
  friction: number
  targetNodeId: string | null
  convexDecompositionLevel: RigidbodyConvexDecompositionLevel
}

export type RigidbodyVector3Tuple = [number, number, number]

export type RigidbodyConvexSimplifyPass = {
  pointTarget: number
  decimalPrecision: number
  vertexMergeTolerance: number
  inflate: number
}

export type RigidbodyConvexSimplifyLimits = {
  maxVertices: number
  maxFaces: number
}

export type RigidbodyConvexSimplifyConfig = {
  version: 1
  primary: RigidbodyConvexSimplifyPass
  fallback: RigidbodyConvexSimplifyPass
  limits: RigidbodyConvexSimplifyLimits
  usedPass?: 'primary' | 'fallback'
}

export type RigidbodyConvexMeshPart = {
  vertices: RigidbodyVector3Tuple[]
  faces: number[][]
  offset?: RigidbodyVector3Tuple
  rotation?: RigidbodyVector3Tuple
}

export type RigidbodyConvexDecompositionFillMode = 'flood' | 'surface' | 'raycast'

export type RigidbodyConvexDecompositionConfig = {
  version: 1
  /** The maximum number of convex hulls to produce. */
  maxHulls: number
  /** The voxel resolution to use. */
  voxelResolution: number
  /** The maximum number of vertices allowed in any output convex hull. */
  maxVerticesPerHull: number
  /** If the voxels are within this percentage of the hull volume, stop splitting. */
  minVolumePercentError: number
  /** The maximum recursion depth. */
  maxRecursionDepth: number
  /** Whether to shrinkwrap the voxel positions to the source mesh on output. */
  shrinkWrap: boolean
  /** How to fill the interior of the voxelized mesh. */
  fillMode: RigidbodyConvexDecompositionFillMode
  /** Whether to attempt to split planes along the best location. */
  findBestPlane: boolean
  /** The actual number of hulls produced by the last run. */
  usedHulls?: number
}

export const DEFAULT_RIGIDBODY_CONVEX_DECOMPOSITION_CONFIG: RigidbodyConvexDecompositionConfig = {
  version: 1,
  maxHulls: 16,
  voxelResolution: 100000,
  maxVerticesPerHull: 32,
  minVolumePercentError: 1,
  maxRecursionDepth: 2,
  shrinkWrap: true,
  fillMode: 'flood',
  findBestPlane: true,
}

export const FINE_RIGIDBODY_CONVEX_DECOMPOSITION_CONFIG: RigidbodyConvexDecompositionConfig = {
  ...DEFAULT_RIGIDBODY_CONVEX_DECOMPOSITION_CONFIG,
  maxHulls: 32,
  voxelResolution: 200000,
  maxRecursionDepth: 4,
}

export const COARSE_RIGIDBODY_CONVEX_DECOMPOSITION_CONFIG: RigidbodyConvexDecompositionConfig = {
  ...DEFAULT_RIGIDBODY_CONVEX_DECOMPOSITION_CONFIG,
  maxHulls: 4,
  maxRecursionDepth: 1,
}

export function resolveRigidbodyConvexDecompositionConfig(
  level: RigidbodyConvexDecompositionLevel | null | undefined,
): RigidbodyConvexDecompositionConfig {
  if (level === 'fine') {
    return FINE_RIGIDBODY_CONVEX_DECOMPOSITION_CONFIG
  }
  if (level === 'coarse') {
    return COARSE_RIGIDBODY_CONVEX_DECOMPOSITION_CONFIG
  }
  return DEFAULT_RIGIDBODY_CONVEX_DECOMPOSITION_CONFIG
}

type RigidbodyPhysicsShapeBase = {
  offset?: RigidbodyVector3Tuple
  rotation?: RigidbodyVector3Tuple
  applyScale: boolean
}

export type RigidbodyPhysicsShape =
  | ({
      kind: 'box'
      halfExtents: RigidbodyVector3Tuple
    } & RigidbodyPhysicsShapeBase)
  | ({
      kind: 'convex'
      vertices: RigidbodyVector3Tuple[]
      faces: number[][]
    } & RigidbodyPhysicsShapeBase)
  | ({
      kind: 'convex-mesh'
      parts: RigidbodyConvexMeshPart[]
    } & RigidbodyPhysicsShapeBase)
  | ({
      kind: 'heightfield'
      matrix: number[][]
      elementSize: number
      width: number
      depth: number
    } & RigidbodyPhysicsShapeBase)
  | ({
      kind: 'static-mesh'
      vertices: RigidbodyVector3Tuple[]
      indices: number[]
    } & RigidbodyPhysicsShapeBase)
  | ({
      kind: 'sphere'
      radius: number
    } & RigidbodyPhysicsShapeBase)
  | ({
      kind: 'capsule'
      radius: number
      height: number
    } & RigidbodyPhysicsShapeBase)
  | ({
      kind: 'cylinder'
      radiusTop: number
      radiusBottom: number
      height: number
      segments?: number
    } & RigidbodyPhysicsShapeBase)

export const RIGIDBODY_METADATA_KEY = '__harmonyRigidbody'

export interface RigidbodyComponentMetadata {
  shape?: RigidbodyPhysicsShape | null
  generatedAt?: string
  convexSimplify?: RigidbodyConvexSimplifyConfig
  convexDecomposition?: RigidbodyConvexDecompositionConfig
}

export const DEFAULT_RIGIDBODY_MASS = 1400
export const DEFAULT_RIGIDBODY_BODY_TYPE: RigidbodyBodyType = 'STATIC'
export const DEFAULT_RIGIDBODY_COLLIDER_TYPE: RigidbodyColliderType = 'convex'
export const DEFAULT_RIGIDBODY_CONVEX_DECOMPOSITION_LEVEL: RigidbodyConvexDecompositionLevel = 'default'
export const MIN_RIGIDBODY_MASS = 0
export const MAX_RIGIDBODY_MASS = 100000
export const DEFAULT_LINEAR_DAMPING = 0.01
export const DEFAULT_ANGULAR_DAMPING = 0.35
export const DEFAULT_RIGIDBODY_RESTITUTION = 0.1
export const DEFAULT_RIGIDBODY_FRICTION = 0.75

export function clampRigidbodyComponentProps(
  props: Partial<RigidbodyComponentProps> | null | undefined,
): RigidbodyComponentProps {
  const rawMass = typeof props?.mass === 'number' && Number.isFinite(props.mass) ? props.mass : DEFAULT_RIGIDBODY_MASS
  const normalizedMass = Math.min(MAX_RIGIDBODY_MASS, Math.max(MIN_RIGIDBODY_MASS, rawMass))
  const normalizedType: RigidbodyBodyType = props?.bodyType === 'DYNAMIC' || props?.bodyType === 'KINEMATIC'
    ? props.bodyType
    : DEFAULT_RIGIDBODY_BODY_TYPE
  const normalizedColliderType: RigidbodyColliderType = isRigidbodyColliderType(props?.colliderType)
    ? props.colliderType
    : DEFAULT_RIGIDBODY_COLLIDER_TYPE
  const normalizedConvexDecompositionLevel: RigidbodyConvexDecompositionLevel =
    isRigidbodyConvexDecompositionLevel(props?.convexDecompositionLevel)
      ? props!.convexDecompositionLevel
      : DEFAULT_RIGIDBODY_CONVEX_DECOMPOSITION_LEVEL
  
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
    convexDecompositionLevel: normalizedConvexDecompositionLevel,
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
    convexDecompositionLevel: props.convexDecompositionLevel ?? DEFAULT_RIGIDBODY_CONVEX_DECOMPOSITION_LEVEL,
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
    if (nodeType === 'light' || nodeType === 'environment') {
      return false
    }
    return true
  },
  createDefaultProps(node: SceneNode) {
    return clampRigidbodyComponentProps({
      bodyType: DEFAULT_RIGIDBODY_BODY_TYPE,
      mass: 0,
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
