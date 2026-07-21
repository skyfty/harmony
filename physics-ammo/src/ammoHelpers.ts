export type AmmoVector3 = [number, number, number]
export type AmmoQuaternion = [number, number, number, number]

export type AmmoApi = {
  destroy: (object: unknown) => void
  _malloc: (size: number) => number
  _free: (ptr: number) => void
  HEAPF32: Float32Array
  btVector3: new (x?: number, y?: number, z?: number) => any
  btQuaternion: new (x?: number, y?: number, z?: number, w?: number) => any
  btTransform: new () => any
  btDefaultMotionState: new (transform?: unknown) => any
  btRigidBodyConstructionInfo: new (mass: number, motionState: unknown, shape: unknown, localInertia?: unknown) => any
  btRigidBody: new (info: unknown) => any
  btBoxShape: new (halfExtents: unknown) => any
  btSphereShape: new (radius: number) => any
  btCylinderShape: new (halfExtents: unknown) => any
  btCapsuleShapeY?: new (radius: number, halfHeight: number) => any
  btConvexHullShape: new () => any
  btCompoundShape: new (enableDynamicAabbTree?: boolean) => any
  btHeightfieldTerrainShape: new (
    heightStickWidth: number,
    heightStickLength: number,
    heightfieldData: unknown,
    heightScale: number,
    minHeight: number,
    maxHeight: number,
    upAxis: number,
    hdt: 'PHY_FLOAT',
    flipQuadEdges: boolean,
  ) => any
  btTriangleMesh: new (use32bitIndices?: boolean, use4componentVertices?: boolean) => any
  btBvhTriangleMeshShape: new (meshInterface: unknown, useQuantizedAabbCompression: boolean, buildBvh?: boolean) => any
  btConvexTriangleMeshShape?: new (meshInterface: unknown, calcAabb?: boolean) => any
  btVehicleTuning: new () => any
  btDefaultVehicleRaycaster: new (world: unknown) => any
  btRaycastVehicle: new (tuning: unknown, chassisBody: unknown, raycaster: unknown) => any
  btDefaultCollisionConfiguration: new () => any
  btCollisionDispatcher: new (configuration: unknown) => any
  btDbvtBroadphase: new () => any
  btSequentialImpulseConstraintSolver: new () => any
  btDiscreteDynamicsWorld: new (
    dispatcher: unknown,
    broadphase: unknown,
    solver: unknown,
    configuration: unknown,
  ) => any
  ClosestRayResultCallback: new (from: unknown, to: unknown) => any
}

export type AmmoTransform = {
  position: AmmoVector3
  rotation: AmmoQuaternion
}

export function createAmmoVector3(ammo: AmmoApi, vector: AmmoVector3): any {
  return new ammo.btVector3(vector[0], vector[1], vector[2])
}

export function createAmmoQuaternion(ammo: AmmoApi, quaternion: AmmoQuaternion): any {
  const normalized = normalizeQuaternion(quaternion)
  return new ammo.btQuaternion(normalized[0], normalized[1], normalized[2], normalized[3])
}

export function createAmmoTransform(ammo: AmmoApi, transform: AmmoTransform): any {
  const position = createAmmoVector3(ammo, transform.position)
  const rotation = createAmmoQuaternion(ammo, transform.rotation)
  const ammoTransform = new ammo.btTransform()
  ammoTransform.setIdentity?.()
  ammoTransform.setOrigin(position)
  ammoTransform.setRotation(rotation)
  ammo.destroy(rotation)
  ammo.destroy(position)
  return ammoTransform
}

export function distanceBetween(a: AmmoVector3, b: AmmoVector3): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

export function normalizeVector(vector: AmmoVector3): AmmoVector3 {
  const length = Math.sqrt(vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2])
  if (!Number.isFinite(length) || length <= 1e-12) {
    return [0, 1, 0]
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

export function isZeroVector(vector: AmmoVector3): boolean {
  return Math.abs(vector[0]) <= 1e-12 && Math.abs(vector[1]) <= 1e-12 && Math.abs(vector[2]) <= 1e-12
}

function normalizeQuaternion(quaternion: AmmoQuaternion): AmmoQuaternion {
  const length = Math.sqrt(
    quaternion[0] * quaternion[0] +
    quaternion[1] * quaternion[1] +
    quaternion[2] * quaternion[2] +
    quaternion[3] * quaternion[3],
  )
  if (!Number.isFinite(length) || length <= 1e-12) {
    return [0, 0, 0, 1]
  }
  return [
    quaternion[0] / length,
    quaternion[1] / length,
    quaternion[2] / length,
    quaternion[3] / length,
  ]
}
