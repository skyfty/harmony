
export type PhysicsBackendId = 'ammo' | 'cannon' | 'noop'
export type PhysicsBackendPreference = PhysicsBackendId | 'auto'

export type PhysicsShapeKind = 'box' | 'sphere' | 'cylinder' | 'convex-hull' | 'heightfield' | 'static-mesh' | 'compound'
export type PhysicsBodyType = 'static' | 'dynamic' | 'kinematic'

export type PhysicsVector3 = [number, number, number]
export type PhysicsQuaternion = [number, number, number, number]

export type PhysicsTransform = {
  position: PhysicsVector3
  rotation: PhysicsQuaternion
}

export type PhysicsContactEvent = {
  bodyIdA: number
  bodyIdB: number
  normal: PhysicsVector3
  point: PhysicsVector3
  impulse?: number | null
  impactSpeed?: number | null
}

export type PhysicsMaterialDesc = {
  id: number
  friction: number
  restitution: number
}

export type PhysicsShapeRef = {
  id: number
  kind: PhysicsShapeKind
}

export type PhysicsBodyDesc = {
  id: number
  type: PhysicsBodyType
  mass: number
  materialId: number | null
  shapeId: number
  transform: PhysicsTransform
  linearDamping?: number
  angularDamping?: number
  userDataKey?: string | null
}

export type PhysicsBoxShapeDesc = {
  id: number
  kind: 'box'
  halfExtents: PhysicsVector3
  applyScale?: boolean
}

export type PhysicsSphereShapeDesc = {
  id: number
  kind: 'sphere'
  radius: number
  applyScale?: boolean
}

export type PhysicsCylinderShapeDesc = {
  id: number
  kind: 'cylinder'
  radiusTop: number
  radiusBottom: number
  height: number
  segments?: number
  applyScale?: boolean
}

export type PhysicsConvexHullShapeDesc = {
  id: number
  kind: 'convex-hull'
  vertices: Float32Array
  faces?: number[][]
  applyScale?: boolean
}

export type PhysicsHeightfieldDesc = {
  id: number
  kind: 'heightfield'
  rows: number
  columns: number
  elementSize: number
  heights: Float32Array
  minHeight?: number
  maxHeight?: number
  localOffset?: PhysicsVector3
  applyScale?: boolean
}

export type PhysicsStaticMeshDesc = {
  id: number
  kind: 'static-mesh'
  vertices: Float32Array
  indices: Uint32Array
  applyScale?: boolean
}

export type PhysicsCompoundChildDesc = {
  shapeId: number
  transform: PhysicsTransform
}

export type PhysicsCompoundShapeDesc = {
  id: number
  kind: 'compound'
  children: PhysicsCompoundChildDesc[]
  applyScale?: boolean
}

export type PhysicsShapeDesc =
  | PhysicsBoxShapeDesc
  | PhysicsSphereShapeDesc
  | PhysicsCylinderShapeDesc
  | PhysicsConvexHullShapeDesc
  | PhysicsHeightfieldDesc
  | PhysicsStaticMeshDesc
  | PhysicsCompoundShapeDesc

export type PhysicsVehicleWheelDesc = {
  id: number
  radius: number
  isFrontWheel: boolean
  connectionPoint: PhysicsVector3
  direction: PhysicsVector3
  axle: PhysicsVector3
  suspensionRestLength: number
  suspensionStiffness: number
  dampingRelaxation: number
  dampingCompression: number
  frictionSlip: number
  rollInfluence: number
  maxSuspensionTravel?: number
  maxSuspensionForce?: number
}

export type PhysicsVehicleDesc = {
  id: number
  bodyId: number
  indexRightAxis: 0 | 1 | 2
  indexUpAxis: 0 | 1 | 2
  indexForwardAxis: 0 | 1 | 2
  maxSpeedKmh?: number
  wheels: PhysicsVehicleWheelDesc[]
}

export type PhysicsCharacterDesc = {
  characterId: number
  bodyId: number
  radius: number
  height: number
  stepHeight: number
  slopeLimitDegrees: number
  jumpImpulse: number
  airControl: number
  walkSpeed: number
  runSpeed: number
  sprintSpeed: number
}

export type PhysicsSceneAsset = {
  format: 'harmony-physics'
  materials: PhysicsMaterialDesc[]
  shapes: PhysicsShapeDesc[]
  bodies: PhysicsBodyDesc[]
  vehicles: PhysicsVehicleDesc[]
  characters: PhysicsCharacterDesc[]
}

export type PhysicsBodySnapshot = {
  bodyId: number
  position: PhysicsVector3
  rotation: PhysicsQuaternion
  linearVelocity?: PhysicsVector3 | null
  angularVelocity?: PhysicsVector3 | null
  sleeping?: boolean
}

export type PhysicsRuntimeBodyEntry = {
  materials?: PhysicsMaterialDesc[]
  shapes: PhysicsShapeDesc[]
  body: PhysicsBodyDesc
}

export type PhysicsBodyTransformCommand = {
  bodyId: number
  transform: PhysicsTransform
  resetVelocity?: boolean
}

export type PhysicsBodyVelocityCommand = {
  bodyId: number
  linearVelocity?: PhysicsVector3 | null
  angularVelocity?: PhysicsVector3 | null
  wakeUp?: boolean
}

export type PhysicsVehicleInputCommand = {
  vehicleId: number
  steering: number
  throttle: number
  brake: number
  handbrake?: number
}

export type PhysicsCharacterInputCommand = {
  characterId: number
  moveX: number
  moveZ: number
  yaw?: number | null
  jump: boolean
  sprint: boolean
  crouch: boolean
  interact: boolean
}

export type PhysicsRaycastCommand = {
  origin: PhysicsVector3
  target: PhysicsVector3
  collisionMask?: number | null
}

export type PhysicsRaycastHit = {
  bodyId: number
  point: PhysicsVector3
  normal: PhysicsVector3
  distance: number
}

export type PhysicsAddRuntimeBodiesCommand = {
  bodies: PhysicsRuntimeBodyEntry[]
}

export type PhysicsRemoveRuntimeBodiesCommand = {
  bodyIds: number[]
}

export type PhysicsWorldSettings = {
  gravity: PhysicsVector3
  fixedTimeStepMs: number
  maxSubSteps: number
}

export type PhysicsInitOptions = {
  world: PhysicsWorldSettings
}

export type PhysicsBridgeInitResult = {
  backend: PhysicsBackendId | string
  workerBacked: boolean
}
