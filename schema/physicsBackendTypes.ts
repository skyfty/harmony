import * as THREE from 'three'
import type {
  RigidbodyComponentProps,
  RigidbodyPhysicsShape,
  RigidbodyVector3Tuple,
} from './components'
import type {
  PhysicsBodyLike,
  PhysicsOrientationAdjustment,
} from './physicsBodySync'
import type { PhysicsWorldLike } from './physicsRuntimeBridge'

export type PhysicsContactSettings = {
  contactEquationStiffness: number
  contactEquationRelaxation: number
  frictionEquationStiffness: number
  frictionEquationRelaxation: number
}

export type PhysicsRigidbodyMaterialEntry = {
  material: unknown
  friction: number
  restitution: number
}

export type PhysicsBodyShapeDefinitionBinding = {
  definition: RigidbodyPhysicsShape
  position?: RigidbodyVector3Tuple
  quaternion?: [number, number, number, number]
}

export type BackendRigidbodyCreateParams = {
  world: PhysicsWorldLike
  mass: number
  bodyType: RigidbodyComponentProps['bodyType']
  shapes: PhysicsBodyShapeDefinitionBinding[]
  shapeScale?: { x?: number; y?: number; z?: number } | null
  rigidbodyMaterialCache: Map<string, PhysicsRigidbodyMaterialEntry>
  rigidbodyContactMaterialKeys: Set<string>
  friction: number
  restitution: number
  contactSettings: PhysicsContactSettings
  name?: string
}

export type EnsurePhysicsWorldParams = {
  world: PhysicsWorldLike | null
  setWorld: (world: PhysicsWorldLike) => void
  gravity: THREE.Vector3
  solverIterations: number
  solverTolerance: number
  contactFriction: number
  contactRestitution: number
  contactSettings: PhysicsContactSettings
  rigidbodyMaterialCache: Map<string, PhysicsRigidbodyMaterialEntry>
  rigidbodyContactMaterialKeys: Set<string>
  /** Use fast approximate quaternion normalization (default false). */
  quatNormalizeFast?: boolean
  /** Normalize quaternions every N steps; 0 = every step (default 0). */
  quatNormalizeSkip?: number
}

export type RoadHeightfieldDebugSurface = {
  matrix: number[][]
  elementSize: number
  offset: [number, number, number]
}

export type BackendRigidbodyResult = {
  body: PhysicsBodyLike
  orientationAdjustment: PhysicsOrientationAdjustment | null
} | null

export type PhysicsBackendShapeScaleLike = { x?: number; y?: number; z?: number } | null | undefined

export type PhysicsBackendBridge = {
  id: 'ammo' | 'cannon'
  normalizeShapeScale: (scaleLike: PhysicsBackendShapeScaleLike) => { x: number; y: number; z: number }
  createRigidbodyBody: (params: BackendRigidbodyCreateParams) => BackendRigidbodyResult
  ensurePhysicsWorld: (params: EnsurePhysicsWorldParams) => PhysicsWorldLike
  extractRoadHeightfieldDebugSurfaces?: (bodies: PhysicsBodyLike[]) => RoadHeightfieldDebugSurface[]
}
