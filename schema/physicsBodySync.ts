import * as THREE from 'three'

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
  sleep?: () => unknown
}

export type PhysicsOrientationAdjustment = {
  three: THREE.Quaternion
  threeInverse: THREE.Quaternion
}

export type PhysicsBodyBindingEntry = {
  nodeId: string
  body: PhysicsBodyLike
  bodies: PhysicsBodyLike[]
  object: THREE.Object3D | null
  orientationAdjustment: PhysicsOrientationAdjustment | null
  signature?: string
  syncObjectFromBody?: boolean
}

const physicsPositionHelper = new THREE.Vector3()
const physicsQuaternionHelper = new THREE.Quaternion()
const physicsScaleHelper = new THREE.Vector3()
const syncBodyQuaternionHelper = new THREE.Quaternion()
const bodyWorldPositionHelper = new THREE.Vector3()
const bodyQuaternionHelper = new THREE.Quaternion()
const bodyParentQuaternionHelper = new THREE.Quaternion()

export function syncBodyFromObject(
  body: PhysicsBodyLike,
  object: THREE.Object3D,
  orientationAdjustment: PhysicsOrientationAdjustment | null = null,
): void {
  object.updateMatrixWorld(true)
  object.matrixWorld.decompose(physicsPositionHelper, physicsQuaternionHelper, physicsScaleHelper)
  syncBodyQuaternionHelper.copy(physicsQuaternionHelper)
  if (orientationAdjustment) {
    syncBodyQuaternionHelper.multiply(orientationAdjustment.three)
  }
  body.position.set(physicsPositionHelper.x, physicsPositionHelper.y, physicsPositionHelper.z)
  if (typeof body.quaternion.set === 'function') {
    body.quaternion.set(
      syncBodyQuaternionHelper.x,
      syncBodyQuaternionHelper.y,
      syncBodyQuaternionHelper.z,
      syncBodyQuaternionHelper.w,
    )
  } else {
    body.quaternion.x = syncBodyQuaternionHelper.x
    body.quaternion.y = syncBodyQuaternionHelper.y
    body.quaternion.z = syncBodyQuaternionHelper.z
    body.quaternion.w = syncBodyQuaternionHelper.w
  }
  body.velocity.set(0, 0, 0)
  body.angularVelocity.set(0, 0, 0)
}

export function syncObjectFromBody(
  entry: Pick<PhysicsBodyBindingEntry, 'object' | 'body' | 'orientationAdjustment'>,
  afterSync?: (object: THREE.Object3D) => void,
): void {
  const { object, body, orientationAdjustment } = entry
  if (!object) {
    return
  }
  bodyWorldPositionHelper.set(body.position.x, body.position.y, body.position.z)
  bodyQuaternionHelper.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w)
  if (orientationAdjustment) {
    bodyQuaternionHelper.multiply(orientationAdjustment.threeInverse)
  }
  if (object.parent) {
    object.parent.updateMatrixWorld(true)
    object.position.copy(bodyWorldPositionHelper)
    object.parent.worldToLocal(object.position)
    object.parent.getWorldQuaternion(bodyParentQuaternionHelper).invert()
    object.quaternion.copy(bodyParentQuaternionHelper).multiply(bodyQuaternionHelper)
  } else {
    object.position.copy(bodyWorldPositionHelper)
    object.quaternion.copy(bodyQuaternionHelper)
  }
  object.updateMatrixWorld(true)
  afterSync?.(object)
}
