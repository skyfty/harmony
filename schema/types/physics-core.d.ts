export const PHYSICS_SCENE_ASSET_VERSION: 1

export type PhysicsShapeKind = 'box' | 'sphere' | 'cylinder' | 'convex-hull' | 'heightfield' | 'static-mesh' | 'compound'
export type PhysicsBodyType = 'static' | 'dynamic' | 'kinematic'

export type PhysicsVector3 = [number, number, number]
export type PhysicsQuaternion = [number, number, number, number]

export type PhysicsTransform = {
  position: PhysicsVector3
  rotation: PhysicsQuaternion
}

export type PhysicsMaterialDesc = {
  id: number
  friction: number
  restitution: number
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
}

export type PhysicsSphereShapeDesc = {
  id: number
  kind: 'sphere'
  radius: number
}

export type PhysicsCylinderShapeDesc = {
  id: number
  kind: 'cylinder'
  radiusTop: number
  radiusBottom: number
  height: number
  segments?: number
}

export type PhysicsConvexHullShapeDesc = {
  id: number
  kind: 'convex-hull'
  vertices: Float32Array
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
}

export type PhysicsStaticMeshDesc = {
  id: number
  kind: 'static-mesh'
  vertices: Float32Array
  indices: Uint32Array
}

export type PhysicsCompoundChildDesc = {
  shapeId: number
  transform: PhysicsTransform
}

export type PhysicsCompoundShapeDesc = {
  id: number
  kind: 'compound'
  children: PhysicsCompoundChildDesc[]
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
  wheels: PhysicsVehicleWheelDesc[]
}

export type PhysicsSceneAsset = {
  format: 'harmony-physics'
  version: typeof PHYSICS_SCENE_ASSET_VERSION
  materials: PhysicsMaterialDesc[]
  shapes: PhysicsShapeDesc[]
  bodies: PhysicsBodyDesc[]
  vehicles: PhysicsVehicleDesc[]
}
