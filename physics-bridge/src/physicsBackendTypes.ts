import type { PhysicsVector3 } from '@harmony/physics-core'

export type PhysicsBodyVec3Like = {
  x: number
  y: number
  z: number
  set: (x: number, y: number, z: number) => unknown
}

export type PhysicsBodyQuaternionLike = {
  x: number
  y: number
  z: number
  w: number
  set?: (x: number, y: number, z: number, w: number) => unknown
}

export type PhysicsBodyLike = {
  type?: number
  position: PhysicsBodyVec3Like
  quaternion: PhysicsBodyQuaternionLike
  velocity: PhysicsBodyVec3Like
  angularVelocity: PhysicsBodyVec3Like
  updateMassProperties?: () => unknown
  linearDamping?: number
  angularDamping?: number
  allowSleep?: boolean
  sleepSpeedLimit?: number
  sleepTimeLimit?: number
  sleep?: () => unknown
}

export type PhysicsWorldLike = {
  addBody: (body: PhysicsBodyLike) => unknown
  removeBody?: (body: PhysicsBodyLike) => unknown
  addContactMaterial?: (contactMaterial: unknown) => unknown
  defaultMaterial?: unknown
}

export type PhysicsBackendShapeScaleLike = { x?: number; y?: number; z?: number } | null | undefined

export type PhysicsShapeScale = { x: number; y: number; z: number }

export type PhysicsRigidbodyBodyType = 'DYNAMIC' | 'STATIC' | 'KINEMATIC'

export type PhysicsShapeDefinitionBase = {
  applyScale?: boolean
  offset?: [number, number, number]
}

export type PhysicsBoxShapeDefinition = {
  kind: 'box'
  halfExtents: [number, number, number]
} & PhysicsShapeDefinitionBase

export type PhysicsSphereShapeDefinition = {
  kind: 'sphere'
  radius: number
} & PhysicsShapeDefinitionBase

export type PhysicsCylinderShapeDefinition = {
  kind: 'cylinder'
  radiusTop: number
  radiusBottom: number
  height: number
  segments?: number
} & PhysicsShapeDefinitionBase

export type PhysicsConvexShapeDefinition = {
  kind: 'convex'
  vertices: Array<[number, number, number]>
  faces?: number[][]
} & PhysicsShapeDefinitionBase

export type PhysicsHeightfieldShapeDefinition = {
  kind: 'heightfield'
  matrix: number[][]
  elementSize: number
  width?: number
  depth?: number
} & PhysicsShapeDefinitionBase

export type PhysicsStaticMeshShapeDefinition = {
  kind: 'static-mesh'
  vertices: Array<[number, number, number]>
  indices: number[]
} & PhysicsShapeDefinitionBase

export type PhysicsShapeDefinition =
  | PhysicsBoxShapeDefinition
  | PhysicsSphereShapeDefinition
  | PhysicsCylinderShapeDefinition
  | PhysicsConvexShapeDefinition
  | PhysicsStaticMeshShapeDefinition
  | PhysicsHeightfieldShapeDefinition

export type PhysicsBodyShapeDefinitionBinding = {
  definition: PhysicsShapeDefinition
  position?: [number, number, number]
  quaternion?: [number, number, number, number]
}

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

export type BackendRigidbodyCreateParams = {
  world: PhysicsWorldLike
  mass: number
  bodyType: PhysicsRigidbodyBodyType
  shapes: PhysicsBodyShapeDefinitionBinding[]
  shapeScale?: PhysicsBackendShapeScaleLike
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
  gravity: PhysicsVector3
  solverIterations: number
  solverTolerance: number
  contactFriction: number
  contactRestitution: number
  contactSettings: PhysicsContactSettings
  rigidbodyMaterialCache: Map<string, PhysicsRigidbodyMaterialEntry>
  rigidbodyContactMaterialKeys: Set<string>
  quatNormalizeFast?: boolean
  quatNormalizeSkip?: number
}

export type PhysicsOrientationAdjustment = {
  three: { x: number; y: number; z: number; w: number }
  threeInverse: { x: number; y: number; z: number; w: number }
}

export type BackendRigidbodyResult = {
  body: PhysicsBodyLike
  orientationAdjustment: PhysicsOrientationAdjustment | null
} | null

export type PhysicsBackendBridge = {
  id: 'ammo' | 'cannon'
  normalizeShapeScale: (scaleLike: PhysicsBackendShapeScaleLike) => PhysicsShapeScale
  createRigidbodyBody: (params: BackendRigidbodyCreateParams) => BackendRigidbodyResult
  ensurePhysicsWorld: (params: EnsurePhysicsWorldParams) => PhysicsWorldLike
}
